declare module 'tweetnacl' {
  export const box: {
    nonceLength: number;
    keyPair(): {
      publicKey: Uint8Array;
      secretKey: Uint8Array;
    };
  } & {
    (message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
    open(cipher: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null;
  };

  export function randomBytes(n: number): Uint8Array;
}