export const genTrackingNumber = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = (n: number) =>
    [...Array(n)].map(() => chars[Math.floor(Math.random()*chars.length)]).join("");
  return `FBX${rand(6)}${rand(3)}`;
};
