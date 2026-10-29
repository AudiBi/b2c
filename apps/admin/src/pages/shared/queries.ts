import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export interface FileItem {
  id: string;
  kind: 'PHOTO' | 'INVOICE' | 'DOCUMENT';
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export const accountKeys = {
  files: (ownerType: string, ownerId: string) => ['files', ownerType, ownerId] as const,
};

export const useFiles = (ownerType: 'PREALERT' | 'PACKAGE', ownerId: string) =>
  useQuery({
    queryKey: accountKeys.files(ownerType, ownerId),
    queryFn: () => api<{ items: FileItem[] }>(`/v1/files?${new URLSearchParams({ ownerType, ownerId }).toString()}`),
  });
