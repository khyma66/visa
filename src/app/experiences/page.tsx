import type { Metadata } from 'next';
import { CommunityHome } from '@/components/CommunityHome';
export const metadata: Metadata = { title: 'Visa experiences' };
export default function ExperiencesPage() { return <CommunityHome key="experiences" experience />; }
