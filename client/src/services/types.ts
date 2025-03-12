// client/src/types.ts
export interface Contact {
  id: string;
  email: string;
  publicKey: string;
  lastMessage: Message | null;
}

export interface Message {
  id: string;
  userId: string;
  contactId: string;
  text: string;
  timestamp: number;
  isRead: number;
  isMine?: boolean;
  isP2P?: boolean;
  encryptedText?: string;
  lastMessage?: Message;
}

export interface TweetNaClKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface EncryptionError {
  message: string;
  details?: string;
  timestamp: number;
}

// Add ChatListProps for ChatList component
export interface ChatListProps {
  contacts: Contact[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  onSelectChat: (contact: Contact) => void;
}

// Define WebRTC-related types
export interface RTCSessionDescriptionData {
  type: RTCSdpType; // Use RTCSdpType for proper typing
  sdp: string;
}

export interface RTCIceCandidateData {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}