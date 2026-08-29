import { z } from 'zod';

export const loginSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export type TLoginBody = z.infer<typeof loginSchema>;
export type TChangePasswordBody = z.infer<typeof changePasswordSchema>;
