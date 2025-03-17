import React, { useState } from 'react';
import { TweetNaClKeyPair } from '../types'; // Додано імпорт
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';
import * as nacl from 'tweetnacl';

interface ApiErrorResponse {
  error?: string;
}

interface AuthFormProps {
  isDarkTheme: boolean;
  onAuthSuccess: (userId: string, userEmail: string, tweetNaclKeyPair?: TweetNaClKeyPair) => void;
}

const AuthForm: React.FC<AuthFormProps> = ({ isDarkTheme, onAuthSuccess }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  const handleAuth = async (isLogin: boolean) => {
    if (!email || !password) return alert('Fill in all fields');
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
    const endpoint = isLogin ? '/login' : '/register';
    try {
      const res = await axios.post<{ id: string; publicKey?: string }>(
        `https://100.64.221.88:4000${endpoint}`,
        { email, password: hashedPassword }
      );
      let tweetNaclKeyPair: TweetNaClKeyPair | undefined;
      if (!isLogin) {
        const newKeyPair = nacl.box.keyPair();
        await axios.put('https://100.64.221.88:4000/update-keys', {
          userId: res.data.id,
          publicKey: Buffer.from(newKeyPair.publicKey).toString('base64'),
        });
        tweetNaclKeyPair = newKeyPair;
        localStorage.setItem(
          'tweetnaclKeyPair',
          JSON.stringify({
            publicKey: Array.from(newKeyPair.publicKey),
            secretKey: Array.from(newKeyPair.secretKey),
          })
        );
      }
      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userEmail', email);
      onAuthSuccess(res.data.id, email, tweetNaclKeyPair);
    } catch (err) {
      alert(`Error: ${(err as AxiosError<ApiErrorResponse>).response?.data?.error || 'Unknown error'}`);
    }
  };

  return (
    <div className={`container vh-100 d-flex flex-column justify-content-center ${isDarkTheme ? 'bg-black text-light' : 'bg-light text-dark'} p-3`}>
      <h3 className="text-center mb-4">My Messenger</h3>
      <input
        type="email"
        className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        className={`form-control mb-2 ${isDarkTheme ? 'bg-dark text-light border-light' : ''}`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <button className="btn btn-primary w-100 mb-2" onClick={() => handleAuth(true)}>
        Login
      </button>
      <button className="btn btn-secondary w-100" onClick={() => handleAuth(false)}>
        Register
      </button>
    </div>
  );
};

export default AuthForm;