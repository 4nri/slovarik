"""Generate independent Russian WAV recordings with explicit dictionary stress.

Requires PyTorch, NumPy and a downloaded Silero v5_5_ru model. No API keys.
Model: https://models.silero.ai/models/tts/ru/v5_5_ru.pt
"""
import argparse
import json
import pathlib
import wave

import numpy as np
import torch

ROOT = pathlib.Path(__file__).resolve().parents[1]


def generate(model_path, output):
    manifest = json.loads((ROOT / 'audio-sources.json').read_text())
    engine = manifest['engine']
    torch.set_num_threads(4)
    model = torch.package.PackageImporter(str(model_path)).load_pickle('tts_models', 'model')
    model.to(torch.device('cpu'))
    output.mkdir(parents=True, exist_ok=True)
    for i, recording in enumerate(manifest['recordings'], 1):
        # The written word is never replaced with a phonetic spelling.
        # Silero accepts + before the stressed vowel; disable automatic guesses.
        assert recording['spoken_text'].replace('+', '').rstrip('.').lower() == recording['text'].lower()
        with torch.inference_mode():
            audio = model.apply_tts(text=recording['spoken_text'],
                                    speaker=engine['speaker'],
                                    sample_rate=engine['sample_rate'],
                                    put_accent=False, put_yo=False)
        samples = audio.detach().cpu().numpy()
        assert np.isfinite(samples).all(), recording['text']
        assert .25 < len(samples) / engine['sample_rate'] < 8, recording['text']
        with wave.open(str(output / recording['source_file']), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(engine['sample_rate'])
            wav.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
        if i % 25 == 0 or i == len(manifest['recordings']):
            print('Generated', i, '/', len(manifest['recordings']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    generate(args.model, args.output)
