import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
export const metadata: Metadata = { title: 'Sign Up' };
export default function SignupPage() { return <AuthForm signup />; }
