import axios from 'axios';
import { Contact, Message } from '../types';

export const fetchChats = async (userId: string) => {
  return axios.get<Contact[]>('http://192.168.31.185:4000/chats', { params: { userId } });
};

export const fetchMessages = async (userId: string, contactId: string) => {
  return axios.get<Message[]>(`http://192.168.31.185:4000/messages?userId=${userId}&contactId=${contactId}`);
};

export const markAsRead = async (userId: string, contactId: string) => {
  return axios.post('http://192.168.31.185:4000/mark-as-read', { userId, contactId });
};