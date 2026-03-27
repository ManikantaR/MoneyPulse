'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@moneypulse/shared';

/** Category with resolved children for tree display. */
export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

/** Fetch flat list of all categories. */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: Category[] }>('/categories'),
  });
}

/** Fetch category tree (parent → children hierarchy). */
export function useCategoryTree() {
  return useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => api.get<{ data: CategoryTreeNode[] }>('/categories/tree'),
  });
}

/** Create a new category. */
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryInput) =>
      api.post<{ data: Category }>('/categories', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/** Update an existing category. */
export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCategoryInput & { id: string }) =>
      api.patch<{ data: Category }>(`/categories/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/** Delete a category. */
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
