import React, { useState, useEffect } from 'react';
import { TweetNaClKeyPair } from '../types';
import axios, { AxiosError } from 'axios';
import CryptoJS from 'crypto-js';
import * as nacl from 'tweetnacl';
import { FaGithub, FaInstagram, FaTelegram } from 'react-icons/fa';
import { RiUser3Line, RiLockLine } from "react-icons/ri";

interface ApiErrorResponse {
  error?: string;
}

interface AuthFormProps {
  isDarkTheme: boolean;
  onAuthSuccess: (userId: string, userEmail: string, password: string) => void;
}

const AuthForm: React.FC<AuthFormProps> = ({ isDarkTheme, onAuthSuccess }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const viewportMeta: HTMLMetaElement = document.createElement('meta');
    viewportMeta.name = 'viewport';
    viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    document.head.appendChild(viewportMeta);

    const style: HTMLStyleElement = document.createElement('style');
    style.innerHTML = `
      input, textarea, select, button { font-size: 16px; touch-action: manipulation; }
      body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; touch-action: none; }
      .safe-area-container { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
    `;
    document.head.appendChild(style);

    let initialDistance: number | null = null;

    const calculateDistance = (touch1: Touch, touch2: Touch): number => {
      const dx = touch2.clientX - touch1.clientX;
      const dy = touch2.clientY - touch1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = calculateDistance(touch1, touch2);

        if (initialDistance === null) initialDistance = currentDistance;
        const distanceChange = Math.abs(currentDistance - initialDistance);
        if (distanceChange > 10) e.preventDefault();
      }
    };

    const handleTouchEnd = () => initialDistance = null;

    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchstart', preventMultiTouch, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchstart', preventMultiTouch);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
      if (viewportMeta.parentNode) viewportMeta.parentNode.removeChild(viewportMeta);
      if (style.parentNode) style.parentNode.removeChild(style);
    };
  }, []);

  const handleAuth = async () => {
    if (!email || !password) {
      setErrorMessage('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Base64);
    const endpoint = isLogin ? '/login' : '/register';

    try {
      const res = await axios.post<{ id: string; publicKey?: string }>(
        `https://100.64.221.88:4000${endpoint}`,
        { email, password: hashedPassword }
      );

      if (!isLogin) {
        const seed = new Uint8Array(Buffer.from(CryptoJS.SHA256(password).toString(CryptoJS.enc.Hex), 'hex').slice(0, 32));
        const newKeyPair = nacl.box.keyPair.fromSecretKey(seed); 
        await axios.put('https://100.64.221.88:4000/update-keys', {
          userId: res.data.id,
          publicKey: Buffer.from(newKeyPair.publicKey).toString('base64'),
        });
        localStorage.setItem('tweetnaclKeyPair', JSON.stringify({
          publicKey: Array.from(newKeyPair.publicKey),
          secretKey: Array.from(newKeyPair.secretKey),
        }));
      }

      localStorage.setItem('userId', res.data.id);
      localStorage.setItem('userEmail', email);
      localStorage.setItem('password', password);
      onAuthSuccess(res.data.id, email, password);
    } catch (err) {
      const errorText = (err as AxiosError<ApiErrorResponse>).response?.data?.error || 'Unknown error';
      setErrorMessage(`Error: ${errorText}`);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAuthMode = () => {
    setIsLogin(!isLogin);
    setErrorMessage(null);
    setEmail('');
    setPassword('');
  };

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100vh',
    minHeight: '-webkit-fill-available',
    background: isDarkTheme ? '#101010' : '#FFFFFF',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    touchAction: 'none',
  };

  const formContainerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '320px',
    perspective: '1000px',
    margin: '0 auto',
    position: 'relative',
    height: '300px',
  };

  const baseFormStyle: React.CSSProperties = {
    background: isDarkTheme ? 'rgba(32, 35, 40, 1)' : 'rgba(230, 235, 240, 1)',
    padding: '20px 15px',
    borderRadius: '12px',
    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)',
    width: '100%',
    transition: 'transform 0.6s ease, opacity 0.4s ease',
    position: 'absolute',
    top: 0,
    left: 0,
    backfaceVisibility: 'hidden',
  };

  const formStyle: React.CSSProperties = {
    ...baseFormStyle,
    transform: isLogin ? 'rotateY(0deg)' : 'rotateY(180deg)',
    opacity: isLogin ? 1 : 0,
    zIndex: isLogin ? 1 : 0,
  };

  const altFormStyle: React.CSSProperties = {
    ...baseFormStyle,
    transform: isLogin ? 'rotateY(-180deg)' : 'rotateY(0deg)',
    opacity: isLogin ? 0 : 1,
    zIndex: isLogin ? 0 : 1,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 12px 12px 40px',
    border: 'none',
    borderRadius: '8px',
    background: isDarkTheme ? '#1E1E1E' : '#F3F4F6',
    fontSize: '16px',
    color: isDarkTheme ? '#fff' : '#2c3e50',
    transition: 'all 0.3s ease',
    outline: 'none',
    WebkitAppearance: 'none',
    touchAction: 'manipulation',
    boxSizing: 'border-box',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    background: 'linear-gradient(90deg, #00C7D4, #00C79D)',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
    touchAction: 'manipulation',
    WebkitAppearance: 'none',
  };

  const footerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
  };

  const iconContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    gap: '20px',
    marginBottom: '10px',
  };

  const iconLinkStyle: React.CSSProperties = {
    color: isDarkTheme ? '#fff' : '#2c3e50',
    transition: 'color 0.3s ease',
  };

  const copyrightStyle: React.CSSProperties = {
    fontSize: '12px',
    color: isDarkTheme ? '#ccc' : '#666',
    textAlign: 'center',
  };

  const inputIconStyle: React.CSSProperties = {
    position: 'absolute',
    left: '15px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: isDarkTheme ? '#8a9aa3' : '#6c757d',
    pointerEvents: 'none',
    zIndex: 2
  };

  return (
    <div className="safe-area-container" style={containerStyle}>
      <div style={formContainerStyle}>
        <div style={formStyle}>
          <h2 style={{ textAlign: 'center', marginBottom: '20px', color: isDarkTheme ? '#fff' : '#2c3e50', fontSize: '22px', fontWeight: 600, letterSpacing: '0.5px' }}>
            Welcome Back
          </h2>
          {errorMessage && <div style={{ color: '#e74c3c', textAlign: 'center', marginBottom: '15px', fontSize: '14px' }}>{errorMessage}</div>}
          <div style={{ position: 'relative', marginBottom: '18px' }}>
            <RiUser3Line style={inputIconStyle} />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Username" required style={inputStyle} />
          </div>
          <div style={{ position: 'relative', marginBottom: '18px' }}>
            <RiLockLine style={inputIconStyle} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required style={inputStyle} />
          </div>
          <button onClick={handleAuth} disabled={isLoading} style={buttonStyle}>
            {isLoading ? <span style={{ marginRight: '8px' }}>⏳</span> : null}
            Log In
          </button>
          <div onClick={toggleAuthMode} style={{ textAlign: 'center', marginTop: '15px', fontSize: '14px', cursor: 'pointer', transition: 'color 0.3s ease', touchAction: 'manipulation' }}>
            <span style={{ color: isDarkTheme ? '#ccc' : '#666' }}>New here? </span>
            <span style={{ color: '#00C7D4' }}>Sign Up</span>
          </div>
        </div>

        <div style={altFormStyle}>
          <h2 style={{ textAlign: 'center', marginBottom: '20px', color: isDarkTheme ? '#fff' : '#2c3e50', fontSize: '22px', fontWeight: 600, letterSpacing: '0.5px' }}>
            Create Account
          </h2>
          {errorMessage && <div style={{ color: '#e74c3c', textAlign: 'center', marginBottom: '15px', fontSize: '14px' }}>{errorMessage}</div>}
          <div style={{ position: 'relative', marginBottom: '18px' }}>
            <RiUser3Line style={inputIconStyle} />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Username" required style={inputStyle} />
          </div>
          <div style={{ position: 'relative', marginBottom: '18px' }}>
            <RiLockLine style={inputIconStyle} />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required style={inputStyle} />
          </div>
          <button onClick={handleAuth} disabled={isLoading} style={buttonStyle}>
            {isLoading ? <span style={{ marginRight: '8px' }}>⏳</span> : null}
            Sign Up
          </button>
          <div onClick={toggleAuthMode} style={{ textAlign: 'center', marginTop: '15px', fontSize: '14px', cursor: 'pointer', transition: 'color 0.3s ease', touchAction: 'manipulation' }}>
            <span style={{ color: isDarkTheme ? '#ccc' : '#666' }}>Already have an account? </span>
            <span style={{ color: '#00C7D4' }}>Log In</span>
          </div>
        </div>
      </div>

      <div style={footerStyle}>
        <div style={iconContainerStyle}>
          <a href="https://github.com/kolsnartem/Messenger" target="_blank" rel="noopener noreferrer" style={iconLinkStyle}><FaGithub size={24} /></a>
          <a href="https://instagram.com/kolsnartem" target="_blank" rel="noopener noreferrer" style={iconLinkStyle}><FaInstagram size={24} /></a>
          <a href="https://t.me/kolsnartem" target="_blank" rel="noopener noreferrer" style={iconLinkStyle}><FaTelegram size={24} /></a>
        </div>
        <div style={copyrightStyle}>© 2025 Open Source Messenger</div>
      </div>
    </div>
  );
};

export default AuthForm;