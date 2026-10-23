import React, { useState } from 'react';
import {
  Banknote, Download, FileText, Milk, Moon, Pencil, Plus, ReceiptText, Sun, Trash2, Users, Wallet,
} from 'lucide-react';
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, EmptyState, Field, IconButton, Input, Modal, Money, PageHeader,
  SearchInput, SegmentedControl, Select, Skeleton, SkeletonText, StatCard, TBody, TD, TH, THead, TR, Table, TableContainer,
  Textarea, Toolbar,
} from '../components/ui';

/**
 * Dev-only design-system gallery at /__ui (no login, no data). Doubles as the reference
 * for how a screen is put together from the primitives. Never shipped: App.tsx only
 * loads it when `import.meta.env.DEV`.
 */
const CUSTOMERS = [
  { id: 1, name: 'Al Rehman Sweets', phone: '0300-1234567', city: 'Lahore', balance: 48500, status: 'active' },
  { id: 2, name: 'Green Valley Cafe', phone: '0301-7654321', city: 'Lahore', balance: -2600, status: 'active' },
  { id: 3, name: 'Hassan Bakers', phone: '0321-5550101', city: 'Kasur', balance: 0, status: 'inactive' },
];

export default function UiGallery() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [tab, setTab] = useState<'all' | 'due' | 'advance'>('all');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(1);

  const toggleTheme = () => {
    document.documentElement.classList.toggle('dark', !dark);
    setDark(!dark);
  };

  return (
    <div className="h-[100dvh] overflow-y-auto bg-canvas text-fg">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <PageHeader
          eyebrow="Design system"
          title="Mooco UI kit"
          description="Every screen is built from these pieces. Tokens live in src/styles/tokens.css, rules in docs/design-system.md."
          actions={
            <>
              <Button variant="secondary" leftIcon={dark ? <Sun /> : <Moon />} onClick={toggleTheme}>
                {dark ? 'Light' : 'Dark'}
              </Button>
              <Button leftIcon={<Plus />} onClick={() => setModalOpen(true)}>New sale</Button>
            </>
          }
        >
          <SegmentedControl
            aria-label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: '7 days' },
              { value: 'month', label: 'This month' },
            ]}
          />
        </PageHeader>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total sales" value={<Money amount={128450} />} icon={<Banknote />} tone="brand" trend={51.1} trendLabel="vs yesterday" />
          <StatCard label="Milk collected" value="580 L" icon={<Milk />} tone="info" trend={-8.4} trendLabel="vs yesterday" hint="2 collections" />
          <StatCard label="Due receivables" value={<Money amount={101000} />} icon={<Wallet />} tone="danger" trend={-3.2} trendGoodWhen="down" onClick={() => setTab('due')} />
          <StatCard label="Loading example" value="" icon={<ReceiptText />} loading />
        </section>

        <section className="flex flex-col gap-3">
          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name, phone, city..." shortcut="F2" className="w-full sm:w-72" />
            <SegmentedControl
              aria-label="Balance filter"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'all', label: 'All', count: 3 },
                { value: 'due', label: 'Due', count: 1 },
                { value: 'advance', label: 'Advance', count: 1 },
              ]}
            />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" leftIcon={<Download />}>Export</Button>
              <Button size="sm" leftIcon={<Plus />}>Add customer</Button>
            </div>
          </Toolbar>

          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Customer</TH>
                  <TH>Contact</TH>
                  <TH>Status</TH>
                  <TH numeric>Balance</TH>
                  <TH className="w-28 text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {CUSTOMERS.map(customer => (
                  <TR key={customer.id} interactive selected={selected === customer.id} onClick={() => setSelected(customer.id)}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-sm font-bold text-fg-muted">{customer.name[0]}</span>
                        <div>
                          <p className="font-semibold">{customer.name}</p>
                          <p className="text-xs text-fg-subtle">{customer.city}</p>
                        </div>
                      </div>
                    </TD>
                    <TD className="tabular-nums text-fg-muted">{customer.phone}</TD>
                    <TD>
                      <Badge tone={customer.status === 'active' ? 'success' : 'neutral'} dot>
                        {customer.status === 'active' ? 'Active' : 'Inactive'}
                      </Badge>
                    </TD>
                    <TD numeric>
                      <Money amount={customer.balance} tone="balance" />
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <IconButton size="sm" aria-label="Ledger" icon={<FileText />} />
                        <IconButton size="sm" aria-label="Edit" icon={<Pencil />} />
                        <IconButton size="sm" aria-label="Delete" icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </section>

        <section className="grid items-start gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Buttons" description="primary, secondary, ghost, soft, danger" />
            <CardBody className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="soft">Soft</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="danger-soft">Danger soft</Button>
              <Button loading>Saving</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Badges" description="soft and solid, every tone" />
            <CardBody className="flex flex-wrap gap-2">
              <Badge>Neutral</Badge>
              <Badge tone="brand" dot>Current</Badge>
              <Badge tone="success" dot>Paid</Badge>
              <Badge tone="danger">Due Rs 48,500</Badge>
              <Badge tone="warning">Low stock</Badge>
              <Badge tone="info">Online</Badge>
              <Badge tone="brand" variant="solid">Enterprise</Badge>
              <Badge tone="danger" variant="solid" size="md">Overdue</Badge>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Form" description="Field wires label, hint and error" />
            <CardBody className="space-y-3">
              <Field label="Customer name" required hint="As written on the bill">
                {control => <Input {...control} placeholder="e.g. Al Rehman Sweets" />}
              </Field>
              <Field label="Amount" error="Amount zero se zyada honi chahiye">
                {control => <Input {...control} inputMode="decimal" defaultValue="0" suffix="Rs" />}
              </Field>
              <Field label="Payment mode">
                {control => (
                  <Select {...control} defaultValue="cash">
                    <option value="cash">Cash</option>
                    <option value="online">Online / Bank</option>
                  </Select>
                )}
              </Field>
              <Field label="Note">{control => <Textarea {...control} placeholder="Optional" />}</Field>
            </CardBody>
            <CardFooter>
              <Button variant="ghost">Cancel</Button>
              <Button>Save</Button>
            </CardFooter>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <EmptyState
              icon={<Users />}
              title="Abhi koi customer nahi"
              description="Pehla customer add karein, phir unka khata yahan nazar aayega."
              action={<Button leftIcon={<Plus />}>Add customer</Button>}
            />
          </Card>
          <Card padded className="space-y-4">
            <p className="text-sm font-semibold text-fg-muted">Skeletons</p>
            <Skeleton className="h-10 w-full" />
            <SkeletonText lines={4} />
          </Card>
        </section>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Confirm sale"
        description="Shared accessible modal with focus trap."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => setModalOpen(false)}>Confirm</Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">Total <Money amount={2500} className="font-bold text-fg" /> cash mein.</p>
      </Modal>
    </div>
  );
}
