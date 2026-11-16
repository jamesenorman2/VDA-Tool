// Runs the attack-vector search off the main thread so the page stays responsive.
import { generateVectors } from './autogen.js';

self.onmessage = (e) => {
  try {
    const { candidates, stats } = generateVectors(e.data);
    self.postMessage({ ok: true, candidates, stats });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
