import React from 'react';
import {
  Activity, BadgePercent, BarChart3, Boxes, CalendarDays, Clock, CreditCard, Droplets, Factory, FileText,
  FlaskConical, GitBranch, HandCoins, Landmark, LayoutGrid, Package, PackageMinus, PackageSearch, PieChart,
  Receipt, ReceiptText, Repeat, Scale, ScanSearch, ShoppingCart, Sparkles, TrendingUp, Truck, Undo2,
  UserCheck, Users, Wallet, AlertTriangle, BookOpen, Banknote, ArrowLeftRight, ClipboardList, Hourglass,
  Snail, Coins, ChartLine, Gauge, BookUser, CalendarRange, FileChartColumn, ListChecks, Milk, NotebookText, Split, Store, Timer, LayoutDashboard
} from 'lucide-react';

const ICONS: Record<string, React.ElementType> = {
  Activity, BadgePercent, BarChart3, Boxes, CalendarDays, Clock, CreditCard, Droplets, Factory, FileText,
  FlaskConical, GitBranch, HandCoins, Landmark, LayoutGrid, Package, PackageMinus, PackageSearch, PieChart,
  Receipt, ReceiptText, Repeat, Scale, ScanSearch, ShoppingCart, Sparkles, TrendingUp, Truck, Undo2,
  UserCheck, Users, Wallet, AlertTriangle, BookOpen, Banknote, ArrowLeftRight, ClipboardList, Hourglass,
  Snail, Coins, ChartLine, Gauge, BookUser, CalendarRange, FileChartColumn, ListChecks, Milk, NotebookText, Split, Store, Timer, LayoutDashboard,
};

const ALIASES: Record<string, string> = { FileBarChart: 'FileChartColumn', LineChart: 'ChartLine' };

export const ReportIcon: React.FC<{ name?: string; size?: number; className?: string }> = ({ name, size = 16, className }) => {
  const Icon = (name && (ICONS[name] || ICONS[ALIASES[name]])) || FileText;
  return <Icon size={size} className={className} aria-hidden="true" />;
};
