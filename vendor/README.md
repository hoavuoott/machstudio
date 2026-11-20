# Bundled components

- `demucs.js` comes from the [Demucs.js web build](https://bakkot.github.io/demucs-js/worker.js). Its [source](https://github.com/bakkot/demucs-js) is available under MIT. The worker bundle is included unmodified with its embedded license notices.
- The WebAssembly and loader come from the same build and use [ONNX Runtime Web 1.23.0](https://www.npmjs.com/package/onnxruntime-web/v/1.23.0), licensed under MIT.
- The unmodified worker bundle also contains [Mediabunny and its MP3 encoder](https://github.com/Vanilagy/mediabunny), available under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). Their source is available in that repository. The editor uses its own WAV encoder.
- The downloadable HTDemucs model has separate personal and research use terms, as documented in LICENSE-demucs.md.
