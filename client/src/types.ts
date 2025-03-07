export interface IdentityKeyPair {
  pubKey: ArrayBuffer;
  privKey: ArrayBuffer;
}

export interface TweetNaClKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface Message {
  id: string;
  userId: string;
  contactId: string;
  text: string;
  encryptedText?: string;
  timestamp: number;
  isRead?: number;
  isMine?: boolean;
  type?: string;
  isP2P?: boolean; // Додано для позначення P2P-повідомлень
}

export interface Contact {
  id: string;
  email: string;
  publicKey: string;
  lastMessage: Message | null;
}

export interface ChatListProps {
  contacts: Contact[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  onSelectChat: (contact: Contact) => void;
}