// Python's heapq, same algorithm (so ties pop in the same order).
import { lt, len, IndexError } from "./runtime.js";

function siftdown(heap, startpos, pos) {
  const newitem = heap[pos];
  while (pos > startpos) {
    const parentpos = (pos - 1) >> 1;
    const parent = heap[parentpos];
    if (lt(newitem, parent)) {
      heap[pos] = parent;
      pos = parentpos;
      continue;
    }
    break;
  }
  heap[pos] = newitem;
}
function siftup(heap, pos) {
  const endpos = heap.length;
  const startpos = pos;
  const newitem = heap[pos];
  let childpos = 2 * pos + 1;
  while (childpos < endpos) {
    const rightpos = childpos + 1;
    if (rightpos < endpos && !lt(heap[childpos], heap[rightpos])) childpos = rightpos;
    heap[pos] = heap[childpos];
    pos = childpos;
    childpos = 2 * pos + 1;
  }
  heap[pos] = newitem;
  siftdown(heap, startpos, pos);
}
export function heappush(heap, item) {
  heap.push(item);
  siftdown(heap, 0, heap.length - 1);
  return null;
}
export function heappop(heap) {
  if (!heap.length) throw new IndexError("index out of range");
  const last = heap.pop();
  if (heap.length) {
    const ret = heap[0];
    heap[0] = last;
    siftup(heap, 0);
    return ret;
  }
  return last;
}
export function heapify(x) {
  for (let i = (len(x) >> 1) - 1; i >= 0; i--) siftup(x, i);
  return null;
}
