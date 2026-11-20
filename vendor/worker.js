/* The upstream worker reads its model from a cache. Supply only the user-approved
   bytes passed by the editor, with no implicit model download in the worker. */
let modelBlob;
self.addEventListener('message', ({ data }) => {
  if (data.type === 'split') modelBlob = data.modelBlob;
});
const openCache = caches.open.bind(caches);
caches.open = async name => {
  if (name !== 'demucs-weights-cache') return openCache(name);
  return {
    async match() {
      if (!modelBlob) throw new Error('Thiếu mô hình HTDemucs.');
      const response = new Response(modelBlob);
      modelBlob = undefined;
      return response;
    }
  };
};
importScripts('./demucs.js');
