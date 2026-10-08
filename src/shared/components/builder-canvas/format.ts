/** "37 of first 1,000", or "37" when the cap did not cut the input. */
export function countLabel(count: number, cap: number, sampled: boolean) {
  const n = count.toLocaleString();
  return sampled ? `${n} of first ${cap.toLocaleString()}` : n;
}
