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
  text: string; // Зберігаємо зашифрований текст на сервері
  encryptedText?: string; // Додаємо поле для шифрованого тексту (не зберігається в базі, лише для передачі)
  timestamp: number;
  isRead?: number;
  isMine?: boolean;
  type?: string;
}

export interface Contact {
  id: string;
  email: string;
  publicKey: string; // Base64 публічний ключ для TweetNaCl
  lastMessage: Message | null;
}

export interface ChatListProps {
  contacts: Contact[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  onSelectChat: (contact: Contact) => void;
}