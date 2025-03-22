export interface IdentityKeyPair {
  pubKey: ArrayBuffer;
  privKey: ArrayBuffer;
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
  lastMessage?: Message | null;
  error?: boolean;
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
  unreadMessages?: Map<string, number>;
}

export interface ChatWindowProps {
  messages: Message[];
  selectedChatId: string | null;
  isDarkTheme: boolean;
  unreadMessagesCount: number;
  showScrollDown: boolean;
  onRetryDecryption: (message: Message) => void;
  onScrollToBottom: (force?: boolean) => void;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  onSendMessage: (text: string) => void;
}