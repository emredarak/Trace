export function checkPasscode(code: string): boolean {
  const expected = process.env.DEMO_PASSCODE ?? "";
  if (!expected || !code) return false;
  return code === expected;
}
