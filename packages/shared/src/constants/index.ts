import type { Category, Institution } from '../types/index.js';

export const DEFAULT_CATEGORIES: Omit<
  Category,
  'id' | 'createdAt' | 'updatedAt'
>[] = [
  {
    name: 'Income',
    icon: '💰',
    color: '#22c55e',
    parentId: null,
    sortOrder: 1,
  },
  {
    name: 'Groceries',
    icon: '🛒',
    color: '#16a34a',
    parentId: null,
    sortOrder: 2,
  },
  {
    name: 'Dining',
    icon: '🍽️',
    color: '#f59e0b',
    parentId: null,
    sortOrder: 3,
  },
  {
    name: 'Gas/Auto',
    icon: '⛽',
    color: '#ef4444',
    parentId: null,
    sortOrder: 4,
  },
  {
    name: 'Shopping',
    icon: '🛍️',
    color: '#3b82f6',
    parentId: null,
    sortOrder: 5,
  },
  {
    name: 'Travel',
    icon: '✈️',
    color: '#8b5cf6',
    parentId: null,
    sortOrder: 6,
  },
  {
    name: 'Entertainment',
    icon: '🎬',
    color: '#ec4899',
    parentId: null,
    sortOrder: 7,
  },
  {
    name: 'Subscriptions',
    icon: '📱',
    color: '#6366f1',
    parentId: null,
    sortOrder: 8,
  },
  {
    name: 'Utilities',
    icon: '💡',
    color: '#14b8a6',
    parentId: null,
    sortOrder: 9,
  },
  {
    name: 'Healthcare',
    icon: '🏥',
    color: '#f43f5e',
    parentId: null,
    sortOrder: 10,
  },
  {
    name: 'Housing',
    icon: '🏠',
    color: '#a855f7',
    parentId: null,
    sortOrder: 11,
  },
  {
    name: 'Insurance',
    icon: '🛡️',
    color: '#64748b',
    parentId: null,
    sortOrder: 12,
  },
  {
    name: 'Education',
    icon: '📚',
    color: '#0ea5e9',
    parentId: null,
    sortOrder: 13,
  },
  {
    name: 'Personal',
    icon: '👤',
    color: '#d946ef',
    parentId: null,
    sortOrder: 14,
  },
  {
    name: 'Transfers',
    icon: '🔄',
    color: '#6b7280',
    parentId: null,
    sortOrder: 15,
  },
];

export const INSTITUTIONS: { value: Institution; label: string }[] = [
  { value: 'boa', label: 'Bank of America' },
  { value: 'chase', label: 'Chase' },
  { value: 'amex', label: 'American Express' },
  { value: 'citi', label: 'Citi' },
  { value: 'other', label: 'Other' },
];

export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MIN_PASSWORD_LENGTH = 16;
export const BCRYPT_COST_FACTOR = 12;
export const LOGIN_RATE_LIMIT = { ttl: 60, limit: 5 };
export const API_RATE_LIMIT = { ttl: 60, limit: 100 };
export const ANALYTICS_CACHE_TTL_SECONDS = 300; // 5 minutes
export const BACKUP_RETENTION_DAYS = 30;
export const APP_VERSION = '1.0.0';
