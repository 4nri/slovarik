"""Verify whole-source waveform preservation. Requires NumPy and FFmpeg."""
import argparse, concurrent.futures, json, pathlib, subprocess, numpy as np
project = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sources', type=pathlib.Path, required=True)
parser.add_argument('--assets', type=pathlib.Path, default=project/'dist')
args = parser.parse_args()
manifest = json.loads((project/'audio-sources.json').read_text())
def pcm(path):
    result = subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),'-f','f32le','-ar','16000','-ac','1','-'],capture_output=True,check=True)
    assert not result.stderr, path
    return np.frombuffer(result.stdout,dtype=np.float32)
def verify(item):
    source = pcm(args.sources/item['source_file'])
    output = pcm(args.assets/'audio'/(item['id']+f"-v{manifest['revision']}.mp3"))
    assert np.sqrt(np.mean(source*source))>.001, (item['text'],'silent source')
    assert (np.abs(source)>.015).sum()>1600, (item['text'],'insufficient speech')
    assert abs(len(output)-len(source)-6880)<80, (item['text'],'duration changed')
    assert np.sqrt(np.mean(output[:2500]**2))<.002, (item['text'],'leading padding lost')
    assert np.sqrt(np.mean(output[-3200:]**2))<.002, (item['text'],'trailing padding lost')
    correlations=[]
    for shift in range(2860,2901):
        chunk=output[shift:shift+len(source)]
        correlations.append(float(np.corrcoef(source,chunk)[0,1]))
    similarity=max(correlations)
    assert similarity>.97, (item['text'],'source speech changed',similarity)
    return similarity
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    scores=list(pool.map(verify,manifest['recordings']))
print('PASS',len(scores),'whole recordings: full source waveforms preserved, min correlation',round(min(scores),5),'quiet head/tail padding, no blank audio.')
