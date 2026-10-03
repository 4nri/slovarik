"""Build whole-word recordings and their packs. Requires ffmpeg; no word slicing."""
import argparse
import concurrent.futures
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def duration(path):
    return float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', str(path)
    ], text=True))


def build(sources, output):
    manifest = json.loads((ROOT / 'audio-sources.json').read_text())
    words, recordings = manifest['words'], manifest['recordings']
    assert len(recordings) == len({w['text'].lower() for w in words})
    assert all(r['text'].lower() == r['spoken_text'].replace('+', '').rstrip('.').lower() for r in recordings)
    revision = manifest['revision']
    audio = output / 'audio'
    audio.mkdir(parents=True, exist_ok=True)
    mapping = {}

    def encode(recording):
        source = sources / recording['source_file']
        assert .25 < duration(source) < 8, source
        target = audio / (recording['id'] + f'-v{revision}.mp3')
        # Feed the COMPLETE source through the filters. Never set -ss, -t or atrim.
        result = subprocess.run([
            'ffmpeg', '-nostdin', '-hide_banner', '-v', 'error', '-y',
            '-i', str(source), '-map_metadata', '-1',
            '-af', 'loudnorm=I=-18:TP=-2:LRA=7,aresample=44100,'
                   'adelay=180:all=1,apad=pad_dur=0.25,asetpts=N/SR/TB',
            '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame',
            '-b:a', '96k', str(target)
        ], capture_output=True, check=True)
        assert not result.stderr, result.stderr.decode()
        assert duration(target) >= duration(source) + .35, target
        return recording['text'].lower(), 'audio/' + target.name

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        mapping.update(pool.map(encode, recordings))
    files = {w['id']: mapping[w['text'].lower()] for w in words}
    packs, index = {}, {}
    for grade in range(1, 5):
        data = bytearray()
        for word in words:
            if word['grade'] != grade:
                continue
            recording = (output / files[word['id']]).read_bytes()
            index[word['id']] = {'grade': grade, 'offset': len(data), 'length': len(recording)}
            data.extend(recording)
        filename = f'audio/grade-{grade}-v{revision}.bin'
        (output / filename).write_bytes(data)
        packs[grade] = {'file': filename, 'bytes': len(data)}
    compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    (output / 'audio-map.js').write_text(
        '/* Each word is a complete independent Russian recording; no slicing. */\n'
        'const AUDIO_FILES = ' + compact(files) + ';\n')
    (output / 'audio-packs.js').write_text(
        '/* Complete MP3 files concatenated with byte offsets. */\n'
        'const AUDIO_PACKS = ' + compact(packs) + ';\n'
        'const AUDIO_INDEX = ' + compact(index) + ';\n')
    print('Built', len(recordings), 'whole-word recordings for', len(words), 'entries.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'dist')
    args = parser.parse_args()
    build(args.sources, args.output)
