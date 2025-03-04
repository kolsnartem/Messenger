import { useState, useEffect } from 'react';
import * as signal from '@privacyresearch/libsignal-protocol-typescript';
import { IdentityKeyPair } from '../types';

export const useAuth = () => {
  const [userId, setUserId] = useState<string | null>(localStorage.getItem('userId'));
  const [identityKeyPair, setIdentityKeyPair] = useState<IdentityKeyPair | null>(null);

  useEffect(() => {
    const init = async () => {
      const storedKeyPair = localStorage.getItem('signalKeyPair');
      if (storedKeyPair) {
        const { publicKey, privateKey } = JSON.parse(storedKeyPair);
        setIdentityKeyPair({
          pubKey: Buffer.from(publicKey, 'base64'),
          privKey: Buffer.from(privateKey, 'base64'),
        });
      }
    };
    init();
  }, []);

  const generateKeyPair = async (): Promise<IdentityKeyPair> => {
    const keyPair = await signal.KeyHelper.generateIdentityKeyPair();
    localStorage.setItem('signalKeyPair', JSON.stringify({
      publicKey: Buffer.from(keyPair.pubKey).toString('base64'),
      privateKey: Buffer.from(keyPair.privKey).toString('base64'),
    }));
    return keyPair;
  };

  return { userId, identityKeyPair, setUserId, setIdentityKeyPair, generateKeyPair };
};