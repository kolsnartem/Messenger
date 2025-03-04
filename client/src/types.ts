export interface IdentityKeyPair {
  pubKey: ArrayBuffer;
  privKey: ArrayBuffer;
}

export interface Message {
  id: string;
  userId: string;
  contactId: string;
  text: string;
  timestamp: number;
  isRead?: number;
  isMine?: boolean;
  type?: string;
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