
import { PriorityLevel } from './types';

export const PRIORITY_COLORS = {
  [PriorityLevel.LOW]: 'bg-slate-100 text-slate-700 border-slate-200',
  [PriorityLevel.MEDIUM]: 'bg-blue-50 text-blue-700 border-blue-200',
  [PriorityLevel.HIGH]: 'bg-amber-50 text-amber-700 border-amber-200',
  [PriorityLevel.URGENT]: 'bg-red-50 text-red-700 border-red-200',
};
