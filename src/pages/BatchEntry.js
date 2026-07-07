import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/axios';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Save, X, Plus, ArrowDownRight, ArrowUpRight, AlertCircle } from 'lucide-react';
import './BatchEntry.css';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

const DEFAULT_INCOME_SENDERS = ['Kaushik', 'Parents', 'Uncle', 'NYU'];
const DEFAULT_INCOME_CATEGORIES = ['deposit', 'refund', 'salary'];

const EXAMPLE_PROMPT = `Income from NYU $5000 for August 2025, federal tax $800, state tax $300, category salary
Income from Parents $1000 September 2025
Groceries at Walmart $150 + $12 tax September 2025
Rent $2000 October 2025
Netflix subscription $15.99 October 2025`;

const BatchEntry = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [promptText, setPromptText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [entries, setEntries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [receivers, setReceivers] = useState([]);
  const [saving, setSaving] = useState(false);

  const returnMonth = parseInt(searchParams.get('month')) || new Date().getMonth() + 1;
  const returnYear = parseInt(searchParams.get('year')) || new Date().getFullYear();

  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const [catRes, recRes] = await Promise.all([
          api.get('/budget/categories'),
          api.get('/budget/receivers')
        ]);
        setCategories(catRes.data.categories || []);
        setReceivers(recRes.data.receivers || []);
      } catch (_) {}
    };
    loadPrefs();
  }, []);

  const handleParse = async () => {
    if (!promptText.trim()) {
      toast.error('Please enter a description of your transactions');
      return;
    }
    if (promptText.length > 4000) {
      toast.error('Text is too long. Please keep it under 4000 characters.');
      return;
    }
    setParsing(true);
    setParseError('');
    setEntries([]);
    try {
      const res = await api.post('/budget/parse-batch', { text: promptText });
      if (res.data.error) {
        setParseError(res.data.error);
      } else if (!res.data.entries || res.data.entries.length === 0) {
        setParseError('No entries could be extracted. Please describe your transactions more specifically (include amounts, months, and whether they are income or expenses).');
      } else {
        setEntries(res.data.entries.map((e, idx) => ({ ...e, _key: idx })));
        toast.success(`${res.data.entries.length} ${res.data.entries.length === 1 ? 'entry' : 'entries'} parsed — review and save below`);
      }
    } catch (error) {
      setParseError(error.response?.data?.message || 'Failed to parse entries. Please try again.');
    } finally {
      setParsing(false);
    }
  };

  const updateEntry = (idx, field, value) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const updateItem = (entryIdx, itemIdx, field, value) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      const items = e.items.map((it, j) => j === itemIdx ? { ...it, [field]: value } : it);
      const subtotal = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
      const isIncome = e.type === 'income';
      const tax = isIncome
        ? (parseFloat(e.stateTax) || 0) + (parseFloat(e.federalTax) || 0)
        : (parseFloat(e.tax) || 0);
      return { ...e, items, subtotal, tax, total: isIncome ? subtotal - tax : subtotal + tax };
    }));
  };

  const recalcTotals = (entryIdx, updatedFields) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      const merged = { ...e, ...updatedFields };
      const isIncome = merged.type === 'income';
      const subtotal = merged.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
      const stateTax = parseFloat(merged.stateTax) || 0;
      const federalTax = parseFloat(merged.federalTax) || 0;
      const expTax = parseFloat(merged.tax) || 0;
      const tax = isIncome ? stateTax + federalTax : expTax;
      const total = isIncome ? subtotal - tax : subtotal + tax;
      return { ...merged, subtotal, tax, total };
    }));
  };

  const addItem = (entryIdx) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      return { ...e, items: [...e.items, { name: '', amount: 0 }] };
    }));
  };

  const removeItem = (entryIdx, itemIdx) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIdx) return e;
      if (e.items.length <= 1) return e;
      const items = e.items.filter((_, j) => j !== itemIdx);
      const subtotal = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
      const isIncome = e.type === 'income';
      const tax = isIncome
        ? (parseFloat(e.stateTax) || 0) + (parseFloat(e.federalTax) || 0)
        : (parseFloat(e.tax) || 0);
      return { ...e, items, subtotal, tax, total: isIncome ? subtotal - tax : subtotal + tax };
    }));
  };

  const removeEntry = (idx) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveAll = async () => {
    if (entries.length === 0) return;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.receiver?.trim()) { toast.error(`Entry ${i + 1}: sender/receiver is required`); return; }
      if (!e.category?.trim()) { toast.error(`Entry ${i + 1}: category is required`); return; }
      if (!e.items?.length || !e.items[0]?.name?.trim()) { toast.error(`Entry ${i + 1}: at least one item is required`); return; }
    }

    setSaving(true);
    try {
      await Promise.all(entries.map(e => {
        const isIncome = e.type === 'income';
        const subtotal = e.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
        const stateTax = parseFloat(e.stateTax) || 0;
        const federalTax = parseFloat(e.federalTax) || 0;
        const tax = isIncome ? stateTax + federalTax : (parseFloat(e.tax) || 0);
        const total = isIncome ? subtotal - tax : subtotal + tax;
        return api.post('/budget', {
          receiver: e.receiver,
          items: e.items.filter(it => it.name?.trim()).map(it => ({
            name: it.name,
            amount: parseFloat(it.amount) || 0
          })),
          subtotal,
          tax,
          stateTax,
          federalTax,
          total,
          category: e.category,
          notes: e.notes || '',
          type: e.type,
          month: e.month,
          year: e.year
        });
      }));
      toast.success(`Saved ${entries.length} ${entries.length === 1 ? 'transaction' : 'transactions'}!`);
      navigate(`/dashboard?month=${returnMonth}&year=${returnYear}`);
    } catch (error) {
      toast.error('Failed to save: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="batch-entry">
      <div className="batch-entry-container">
        {/* Top bar */}
        <div className="batch-topbar">
          <button className="back-link" onClick={() => navigate(`/dashboard?month=${returnMonth}&year=${returnYear}`)} type="button">
            <ArrowLeft size={18} /> Back
          </button>
          <h1 className="batch-title">Bulk Add Transactions</h1>
          <div className="topbar-spacer" />
        </div>

        {/* Prompt section */}
        <div className="batch-prompt-card">
          <h2>Describe your transactions</h2>
          <p className="batch-subtitle">
            Describe multiple income and expense entries across any months in plain text. Be specific about amounts, months, and whether each is income or an expense.
          </p>
          <div className="batch-example">
            <span className="batch-example-label">Example:</span>
            <pre className="batch-example-text">{EXAMPLE_PROMPT}</pre>
            <button
              type="button"
              className="batch-example-fill"
              onClick={() => setPromptText(EXAMPLE_PROMPT)}
            >
              Use example
            </button>
          </div>
          <textarea
            className="batch-textarea"
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder="e.g. Income from NYU $5000 for August 2025, federal tax $800, state tax $300&#10;Groceries at Walmart $150 + $12 tax September 2025&#10;Rent $2000 October 2025"
            rows={8}
          />
          <button
            className="batch-parse-button"
            onClick={handleParse}
            disabled={parsing || !promptText.trim()}
            type="button"
          >
            <Sparkles size={18} />
            {parsing ? 'Parsing...' : 'Parse Entries'}
          </button>
        </div>

        {/* Parse error */}
        {parseError && (
          <div className="batch-error">
            <AlertCircle size={20} />
            <div>
              <strong>Could not parse entries</strong>
              <p>{parseError}</p>
            </div>
          </div>
        )}

        {/* Entry cards */}
        {entries.length > 0 && (
          <div className="batch-entries-section">
            <div className="batch-entries-header">
              <h2>{entries.length} {entries.length === 1 ? 'Entry' : 'Entries'} — Review &amp; Edit</h2>
              <button
                className="batch-save-all"
                onClick={handleSaveAll}
                disabled={saving}
                type="button"
              >
                <Save size={18} /> {saving ? 'Saving...' : `Save All (${entries.length})`}
              </button>
            </div>
            <div className="batch-cards-list">
              {entries.map((entry, idx) => {
                const isIncome = entry.type === 'income';
                const subtotal = entry.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
                const stateTax = parseFloat(entry.stateTax) || 0;
                const federalTax = parseFloat(entry.federalTax) || 0;
                const expTax = parseFloat(entry.tax) || 0;
                const tax = isIncome ? stateTax + federalTax : expTax;
                const total = isIncome ? subtotal - tax : subtotal + tax;

                return (
                  <div key={entry._key} className={`batch-card ${isIncome ? 'income' : 'expense'}`}>
                    {/* Card header row */}
                    <div className="batch-card-header">
                      <div className={`batch-type-pill ${isIncome ? 'income' : 'expense'}`}>
                        {isIncome ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                        <span>{isIncome ? 'Income' : 'Expense'}</span>
                      </div>
                      <div className="batch-card-month">
                        <select
                          value={entry.month}
                          onChange={e => updateEntry(idx, 'month', parseInt(e.target.value))}
                          className="batch-mini-select"
                        >
                          {MONTH_NAMES.map((m, i) => (
                            <option key={i + 1} value={i + 1}>{m}</option>
                          ))}
                        </select>
                        <select
                          value={entry.year}
                          onChange={e => updateEntry(idx, 'year', parseInt(e.target.value))}
                          className="batch-mini-select"
                        >
                          {Array.from({ length: 12 }, (_, i) => 2020 + i).map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                      <div className="batch-type-toggle">
                        <button
                          type="button"
                          className={`batch-type-btn expense ${!isIncome ? 'active' : ''}`}
                          onClick={() => recalcTotals(idx, { type: 'expense' })}
                        >Expense</button>
                        <button
                          type="button"
                          className={`batch-type-btn income ${isIncome ? 'active' : ''}`}
                          onClick={() => recalcTotals(idx, { type: 'income' })}
                        >Income</button>
                      </div>
                      <button
                        type="button"
                        className="batch-remove-entry"
                        onClick={() => removeEntry(idx)}
                        title="Remove this entry"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    {/* Card body — horizontal grid */}
                    <div className="batch-card-body">
                      {/* Sender/Receiver */}
                      <div className="batch-field">
                        <label>{isIncome ? 'Sender' : 'Receiver'}</label>
                        <select
                          value={entry.receiver}
                          onChange={e => updateEntry(idx, 'receiver', e.target.value)}
                          className="batch-select"
                        >
                          <option value="">Select...</option>
                          {isIncome && DEFAULT_INCOME_SENDERS.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                          {receivers.filter(r => !isIncome || !DEFAULT_INCOME_SENDERS.includes(r)).map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                          {entry.receiver && !DEFAULT_INCOME_SENDERS.includes(entry.receiver) && !receivers.includes(entry.receiver) && (
                            <option value={entry.receiver}>{entry.receiver}</option>
                          )}
                        </select>
                        <input
                          type="text"
                          className="batch-input"
                          value={entry.receiver}
                          onChange={e => updateEntry(idx, 'receiver', e.target.value)}
                          placeholder={isIncome ? 'or type sender...' : 'or type receiver...'}
                        />
                      </div>

                      {/* Items */}
                      <div className="batch-field batch-field-items">
                        <label>Items</label>
                        {entry.items.map((item, itemIdx) => (
                          <div key={itemIdx} className="batch-item-row">
                            <input
                              type="text"
                              className="batch-input batch-item-name"
                              value={item.name}
                              onChange={e => updateItem(idx, itemIdx, 'name', e.target.value)}
                              placeholder="Item"
                            />
                            <span className="batch-item-dollar">$</span>
                            <input
                              type="number"
                              className="batch-input batch-item-amount"
                              value={item.amount}
                              onChange={e => updateItem(idx, itemIdx, 'amount', e.target.value)}
                              step="0.01"
                              min="0"
                            />
                            {entry.items.length > 1 && (
                              <button type="button" className="batch-remove-item" onClick={() => removeItem(idx, itemIdx)}>
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button type="button" className="batch-add-item" onClick={() => addItem(idx)}>
                          <Plus size={12} /> item
                        </button>
                      </div>

                      {/* Tax */}
                      <div className="batch-field">
                        <label>{isIncome ? 'Taxes (deducted)' : 'Tax'}</label>
                        {isIncome ? (
                          <>
                            <div className="batch-tax-row">
                              <span className="batch-tax-label">State</span>
                              <input
                                type="number"
                                className="batch-input batch-tax-input"
                                value={entry.stateTax || ''}
                                onChange={e => recalcTotals(idx, { stateTax: e.target.value })}
                                placeholder="0.00"
                                step="0.01"
                                min="0"
                              />
                            </div>
                            <div className="batch-tax-row">
                              <span className="batch-tax-label">Federal</span>
                              <input
                                type="number"
                                className="batch-input batch-tax-input"
                                value={entry.federalTax || ''}
                                onChange={e => recalcTotals(idx, { federalTax: e.target.value })}
                                placeholder="0.00"
                                step="0.01"
                                min="0"
                              />
                            </div>
                          </>
                        ) : (
                          <input
                            type="number"
                            className="batch-input"
                            value={entry.tax || ''}
                            onChange={e => recalcTotals(idx, { tax: e.target.value })}
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                          />
                        )}
                      </div>

                      {/* Category */}
                      <div className="batch-field">
                        <label>Category</label>
                        <select
                          value={entry.category}
                          onChange={e => updateEntry(idx, 'category', e.target.value)}
                          className="batch-select"
                        >
                          <option value="">Select...</option>
                          {isIncome && DEFAULT_INCOME_CATEGORIES.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          {categories.filter(c => !isIncome || !DEFAULT_INCOME_CATEGORIES.includes(c)).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>

                      {/* Notes */}
                      <div className="batch-field batch-field-notes">
                        <label>Notes</label>
                        <input
                          type="text"
                          className="batch-input"
                          value={entry.notes}
                          onChange={e => updateEntry(idx, 'notes', e.target.value)}
                          placeholder="Optional..."
                        />
                      </div>

                      {/* Total summary */}
                      <div className="batch-field batch-field-total">
                        <div className="batch-total-block">
                          <div className="batch-total-row">
                            <span>{isIncome ? 'Gross' : 'Subtotal'}</span>
                            <span>${subtotal.toFixed(2)}</span>
                          </div>
                          {isIncome ? (
                            <>
                              {stateTax > 0 && <div className="batch-total-row deduction"><span>State Tax</span><span>-${stateTax.toFixed(2)}</span></div>}
                              {federalTax > 0 && <div className="batch-total-row deduction"><span>Federal Tax</span><span>-${federalTax.toFixed(2)}</span></div>}
                            </>
                          ) : (
                            expTax > 0 && <div className="batch-total-row"><span>Tax</span><span>+${expTax.toFixed(2)}</span></div>
                          )}
                          <div className={`batch-total-row batch-grand-total ${isIncome ? 'income' : 'expense'}`}>
                            <span>{isIncome ? 'Net Income' : 'Total'}</span>
                            <span>${total.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="batch-save-footer">
              <button
                className="batch-save-all"
                onClick={handleSaveAll}
                disabled={saving}
                type="button"
              >
                <Save size={18} /> {saving ? 'Saving...' : `Save All (${entries.length})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BatchEntry;
