import * as nacl from 'tweetnacl';
import { EncryptionError, TweetNaClKeyPair } from './types';
import axios from 'axios';

export const logEncryptionEvent = (event: string, details?: any) => {
  console.log(`[Encryption] ${event}`, details || '');
};

export const cleanBase64 = (base64Str: string): string => {
  const cleaned = base64Str.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
  logEncryptionEvent('Cleaned Base64 string', { original: base64Str, cleaned });
  return cleaned;
};

export const fixPublicKey = (key: Uint8Array): Uint8Array => {
  logEncryptionEvent('Checking public key', { bytes: Array.from(key), length: key.length });
  if (key.length === 33) {
    if (key[0] === 0x00 || key[0] === 0x01) {
      logEncryptionEvent('Trimming prefix byte from 33-byte key', { prefix: key[0] });
      return key.slice(1);
    }
    throw new Error(`Unexpected prefix in 33-byte public key: ${key[0]}`);
  }
  if (key.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${key.length}`);
  }
  return key;
};

export const initializeTweetNaclKeys = (): TweetNaClKeyPair => {
  const storedKeyPair = localStorage.getItem('tweetnaclKeyPair');
  if (storedKeyPair) {
    try {
      const parsed = JSON.parse(storedKeyPair);
      const publicKey = new Uint8Array(parsed.publicKey);
      const secretKey = new Uint8Array(parsed.secretKey);
      if (publicKey.length !== 32 || secretKey.length !== 32) {
        throw new Error('Invalid stored key pair dimensions');
      }
      logEncryptionEvent('Loaded stored TweetNaCl keys', { publicKeyLength: publicKey.length });
      return { publicKey, secretKey };
    } catch (error) {
      logEncryptionEvent('Failed to load stored keys, generating new', error);
    }
  }
  const newKeyPair = nacl.box.keyPair();
  const publicKeyBase64 = Buffer.from(newKeyPair.publicKey).toString('base64');
  localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
    publicKey: Array.from(newKeyPair.publicKey),
    secretKey: Array.from(newKeyPair.secretKey),
  }));
  logEncryptionEvent('Generated new TweetNaCl keys', { publicKey: publicKeyBase64 });
  return newKeyPair;
};

export const encryptMessage = (text: string, contactPublicKey: string, tweetNaclKeyPair: TweetNaClKeyPair): string => {
  if (!tweetNaclKeyPair) {
    const error: EncryptionError = { message: 'TweetNaCl key pair not initialized', timestamp: Date.now() };
    logEncryptionEvent('Encryption failed', error);
    throw new Error(error.message);
  }

  const cleanedPublicKey = cleanBase64(contactPublicKey || '');
  if (!cleanedPublicKey) {
    const error: EncryptionError = { message: 'No valid public key provided for encryption', timestamp: Date.now() };
    logEncryptionEvent('Encryption failed', error);
    throw new Error(error.message);
  }

  let theirPublicKeyBuffer: Buffer;
  try {
    theirPublicKeyBuffer = Buffer.from(cleanedPublicKey, 'base64');
    logEncryptionEvent('Decoded contact public key', { base64: cleanedPublicKey, length: theirPublicKeyBuffer.length });
  } catch (error) {
    const encryptionError: EncryptionError = {
      message: 'Invalid Base64 public key format',
      details: (error as Error).message,
      timestamp: Date.now(),
    };
    logEncryptionEvent('Encryption failed', encryptionError);
    throw new Error(encryptionError.message);
  }

  const theirPublicKey = fixPublicKey(new Uint8Array(theirPublicKeyBuffer));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(
    new TextEncoder().encode(text),
    nonce,
    theirPublicKey,
    tweetNaclKeyPair.secretKey
  );

  if (!encrypted) {
    const error: EncryptionError = { message: 'Encryption process failed', timestamp: Date.now() };
    logEncryptionEvent('Encryption failed', error);
    throw new Error(error.message);
  }

  const result = `base64:${Buffer.from(new Uint8Array([...nonce, ...encrypted])).toString('base64')}`;
  logEncryptionEvent('Message encrypted successfully', { encryptedLength: result.length });
  return result;
};

export const storeSentMessage = (messageId: string, text: string, chatId: string) => {
  const storedMessages = JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}');
  storedMessages[messageId] = text;
  localStorage.setItem(`sentMessages_${chatId}`, JSON.stringify(storedMessages));
};

export const getSentMessage = (messageId: string, chatId: string): string | null => {
  const storedMessages = JSON.parse(localStorage.getItem(`sentMessages_${chatId}`) || '{}');
  return storedMessages[messageId] || null;
};

export const fetchSenderPublicKey = async (
  senderId: string,
  contacts: any[],
  searchResults: any[],
  publicKeysCache: Map<string, string>
): Promise<string> => {
  if (publicKeysCache.has(senderId)) {
    return publicKeysCache.get(senderId)!;
  }

  let senderPublicKey = cleanBase64(
    contacts.find(c => c.id === senderId)?.publicKey ||
    searchResults.find(c => c.id === senderId)?.publicKey ||
    localStorage.getItem(`publicKey_${senderId}`) || ''
  );

  if (!senderPublicKey) {
    logEncryptionEvent(`No public key found locally for sender ${senderId}, fetching from server`);
    try {
      const res = await axios.get(`https://100.64.221.88:4000/users?id=${senderId}`);
      const key = cleanBase64(res.data.publicKey || '');
      if (key && key.length === 44) {
        senderPublicKey = key;
        publicKeysCache.set(senderId, senderPublicKey);
        localStorage.setItem(`publicKey_${senderId}`, senderPublicKey);
      } else {
        throw new Error('Invalid public key format from server');
      }
    } catch (err) {
      const error: EncryptionError = {
        message: 'Failed to fetch sender public key',
        details: (err as Error).message,
        timestamp: Date.now(),
      };
      logEncryptionEvent('Decryption failed', error);
      throw new Error(error.message);
    }
  }
  publicKeysCache.set(senderId, senderPublicKey);
  return senderPublicKey;
};

export const decryptMessage = async (
  encryptedText: string,
  senderId: string,
  tweetNaclKeyPair: TweetNaClKeyPair,
  fetchSenderPublicKey: (senderId: string) => Promise<string>
): Promise<string> => {
  if (!encryptedText.startsWith('base64:')) {
    logEncryptionEvent('Message not encrypted, returning as is', { text: encryptedText });
    return encryptedText;
  }

  if (!tweetNaclKeyPair) {
    const error: EncryptionError = { message: 'TweetNaCl key pair not initialized for decryption', timestamp: Date.now() };
    logEncryptionEvent('Decryption failed', error);
    throw new Error(error.message);
  }

  const base64Data = encryptedText.slice(7);
  const data = Buffer.from(base64Data, 'base64');
  const nonce = data.subarray(0, nacl.box.nonceLength);
  const cipher = data.subarray(nacl.box.nonceLength);

  const senderPublicKey = await fetchSenderPublicKey(senderId);

  try {
    const theirPublicKeyBuffer = Buffer.from(senderPublicKey, 'base64');
    const theirPublicKey = fixPublicKey(new Uint8Array(theirPublicKeyBuffer));
    const decrypted = nacl.box.open(
      new Uint8Array(cipher),
      new Uint8Array(nonce),
      theirPublicKey,
      tweetNaclKeyPair.secretKey
    );

    if (!decrypted) {
      const error: EncryptionError = { message: `Decryption failed for message from ${senderId}`, timestamp: Date.now() };
      logEncryptionEvent('Decryption failed', error);
      throw new Error(error.message);
    }

    const result = new TextDecoder().decode(decrypted);
    logEncryptionEvent('Message decrypted successfully', { senderId });
    return result;
  } catch (error) {
    const encryptionError: EncryptionError = {
      message: 'Decryption error',
      details: (error as Error).message,
      timestamp: Date.now(),
    };
    logEncryptionEvent('Decryption failed', encryptionError);
    throw new Error(encryptionError.message);
  }
};