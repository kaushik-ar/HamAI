import React, { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../utils/axios';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import {
  LogOut, DollarSign, Calendar, Tag, Trash2, Edit2,
  ChevronLeft, ChevronRight, ChevronDown, PieChart,
  Search, TrendingUp, Download, User, ArrowDownRight, ArrowUpRight, Plus, Layers
} from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';
import {
  PieChart as RechartsPieChart, Pie, Cell,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { getCategoryColor as getCategoryColorUtil, initializeCategoryColorMap, ensureCategoryColors, colorPalette } from '../utils/categoryColors';
import * as XLSX from 'xlsx';
import './Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Month/Year state - default to current month (January 2026) or from URL
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1; // 1-12
  const defaultMonth = currentMonth; // Current month
  const defaultYear = currentYear; // Current year
  
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'year' | 'overall'
  const [selectedMonth, setSelectedMonth] = useState(
    parseInt(searchParams.get('month')) || defaultMonth
  );
  const [selectedYear, setSelectedYear] = useState(
    parseInt(searchParams.get('year')) || defaultYear
  );
  
  const [stats, setStats] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [transactionSort, setTransactionSort] = useState('largest'); // 'largest' | 'smallest'
  const [groupBy, setGroupBy] = useState('none'); // 'none' | 'category' | 'receiver'
  const [entryTypeFilter, setEntryTypeFilter] = useState('expense'); // 'expense' | 'income'
  const [categories, setCategories] = useState([]);
  const [receivers, setReceivers] = useState([]);
  const [editingItem, setEditingItem] = useState(null); // { type: 'category'|'receiver', oldValue: string, newValue: string }
  const [activeTab, setActiveTab] = useState('table'); // 'table', 'analytics', or 'categories'
  const { logout, user } = useContext(AuthContext);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [earliestRecordedMonth, setEarliestRecordedMonth] = useState(null); // { year, month } | null
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, entry: null });
  const [detailsModal, setDetailsModal] = useState({ open: false, tx: null });
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [categoryColorMap, setCategoryColorMap] = useState(initializeCategoryColorMap);

  // Mr.Ham chatbot state
  const [mrHamOpen, setMrHamOpen] = useState(false);
  const [mrHamMessages, setMrHamMessages] = useState([
    {
      id: 'mrham-welcome',
      from: 'mrham',
      text:
        "Oink oink! I'm Mr. Ham, your little piggy budget buddy. I only look at the transactions you've saved here and turn them into simple insights. Try asking me things like: \"Which category is eating most of my money?\" or \"How much did I spend on groceries last month?\""
    }
  ]);
  const [mrHamInput, setMrHamInput] = useState('');
  const [mrHamLoading, setMrHamLoading] = useState(false);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Shorter year range so dropdown stays manageable (short and scrollable)
  const years = useMemo(() => {
    const min = currentYear - 30;
    const max = currentYear + 5;
    const list = [];
    for (let y = min; y <= max; y++) list.push(y);
    return list;
  }, [currentYear]);

  // Months from current back to first recorded month (no future), scrollable list — for month-view dropdown
  const selectableMonths = useMemo(() => {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const list = [];
    let y = currentYear;
    let m = currentMonth;
    const endYear = earliestRecordedMonth?.year;
    const endMonth = earliestRecordedMonth?.month;
    while (true) {
      list.push({ year: y, month: m, label: `${monthNames[m - 1]} ${y}`, value: `${y}-${m}` });
      if (endYear != null && endMonth != null && y === endYear && m === endMonth) break;
      if (earliestRecordedMonth == null && list.length >= 12) break; // no data yet: show 12 months
      m--;
      if (m < 1) {
        m = 12;
        y--;
      }
      if (list.length > 500) break; // safety cap
    }
    return list;
  }, [currentYear, currentMonth, earliestRecordedMonth]);

  // Ensure all categories have colors assigned (runs when categories change)
  useEffect(() => {
    ensureCategoryColors(categories, setCategoryColorMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]); // Only depend on categories, not categoryColorMap

  // Also ensure categories from entries have colors assigned
  useEffect(() => {
    if (entries.length > 0) {
      const entryCategories = new Set();
      entries.forEach(entry => {
        if (entry.category) {
          entryCategories.add(entry.category.toLowerCase());
        }
      });
      if (entryCategories.size > 0) {
        ensureCategoryColors(Array.from(entryCategories), setCategoryColorMap);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [categoriesResponse, receiversResponse] = await Promise.all([
        api.get('/budget/categories'),
        api.get('/budget/receivers')
      ]);
      const fetchedCategories = categoriesResponse.data.categories || [];
      const fetchedReceivers = receiversResponse.data.receivers || [];
      setCategories(fetchedCategories);
      setReceivers(fetchedReceivers);

      if (viewMode === 'month') {
        const statsResponse = await api.get(`/budget/stats/summary?month=${selectedMonth}&year=${selectedYear}`);
        const data = statsResponse.data;
        setStats(data);
        const rawEntries = data?.entries || [];
        const entryCategories = new Set();
        rawEntries.forEach(entry => {
          if (entry.category) entryCategories.add(entry.category.toLowerCase());
        });
        const allCategories = Array.from(new Set([...fetchedCategories.map(c => c.toLowerCase()), ...entryCategories]));
        if (allCategories.length > 0) {
          setCategoryColorMap(prevMap => {
            const updatedMap = { ...prevMap };
            let mapUpdated = false;
            allCategories.forEach(cat => {
              if (!updatedMap[cat]) {
                updatedMap[cat] = getCategoryColorUtil(cat, updatedMap, null);
                mapUpdated = true;
              }
            });
            if (mapUpdated) localStorage.setItem('categoryColorMap', JSON.stringify(updatedMap));
            return mapUpdated ? updatedMap : prevMap;
          });
        }
        setEntries(rawEntries);
      } else {
        const allResponse = await api.get('/budget?limit=5000');
        const allEntries = (allResponse.data?.entries || []).map(e => ({
          ...e,
          year: e.year || (e.createdAt ? new Date(e.createdAt).getFullYear() : currentYear),
          month: e.month || (e.createdAt ? new Date(e.createdAt).getMonth() + 1 : 1)
        }));
        if (allEntries.length > 0) {
          const minY = Math.min(...allEntries.map((e) => e.year));
          const minMonthEntries = allEntries.filter((e) => e.year === minY);
          const minM = Math.min(...minMonthEntries.map((e) => e.month));
          setEarliestRecordedMonth((prev) => {
            if (!prev) return { year: minY, month: minM };
            if (minY < prev.year || (minY === prev.year && minM < prev.month)) return { year: minY, month: minM };
            return prev;
          });
        }
        let scopeEntries = viewMode === 'year' ? allEntries.filter(e => e.year === selectedYear) : allEntries;
        const totalSpent = scopeEntries.reduce((sum, e) => sum + (Number(e.total) || 0), 0);
        const categoryTotals = {};
        scopeEntries.forEach(e => {
          const cat = (e.category || 'other').toLowerCase();
          categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(e.total) || 0);
        });
        const scopeCategories = [...new Set(scopeEntries.map(e => (e.category || 'other').toLowerCase()))];
        setStats({
          totalSpent,
          totalEntries: scopeEntries.length,
          categoryTotals,
          categories: scopeCategories,
          entries: scopeEntries
        });
        const entryCategories = new Set(scopeEntries.map(e => (e.category || 'other').toLowerCase()));
        const allCategories = Array.from(new Set([...fetchedCategories.map(c => c.toLowerCase()), ...entryCategories]));
        if (allCategories.length > 0) {
          setCategoryColorMap(prevMap => {
            const updatedMap = { ...prevMap };
            let mapUpdated = false;
            allCategories.forEach(cat => {
              if (!updatedMap[cat]) {
                updatedMap[cat] = getCategoryColorUtil(cat, updatedMap, null);
                mapUpdated = true;
              }
            });
            if (mapUpdated) localStorage.setItem('categoryColorMap', JSON.stringify(updatedMap));
            return mapUpdated ? updatedMap : prevMap;
          });
        }
        setEntries(scopeEntries);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setStats(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedMonth, selectedYear, currentYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // In month view, if selected month is in the future, clamp to current month
  useEffect(() => {
    if (viewMode !== 'month') return;
    const isFuture = selectedYear > currentYear || (selectedYear === currentYear && selectedMonth > currentMonth);
    if (isFuture) {
      setSelectedMonth(currentMonth);
      setSelectedYear(currentYear);
      setSearchParams({ month: currentMonth, year: currentYear });
    }
  }, [viewMode, selectedMonth, selectedYear, currentMonth, currentYear, setSearchParams]);

  // Close month dropdown when leaving month view
  useEffect(() => {
    if (viewMode !== 'month') setMonthDropdownOpen(false);
  }, [viewMode]);

  // When in month view only, fetch all entries once to get earliest recorded month
  useEffect(() => {
    if (viewMode !== 'month' || earliestRecordedMonth != null) return;
    let cancelled = false;
    api.get('/budget?limit=5000')
      .then((res) => {
        if (cancelled) return;
        const entries = res.data?.entries || [];
        if (entries.length === 0) return;
        const withYM = entries.map((e) => ({
          year: e.year || (e.createdAt ? new Date(e.createdAt).getFullYear() : new Date().getFullYear()),
          month: e.month || (e.createdAt ? new Date(e.createdAt).getMonth() + 1 : 1)
        }));
        const minY = Math.min(...withYM.map((e) => e.year));
        const minM = Math.min(...withYM.filter((e) => e.year === minY).map((e) => e.month));
        setEarliestRecordedMonth({ year: minY, month: minM });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [viewMode, earliestRecordedMonth]);

  const handleDelete = async (id, entry = null) => {
    try {
      const month = entry?.month ?? selectedMonth;
      const year = entry?.year ?? selectedYear;
      await api.delete(`/budget/${id}?month=${month}&year=${year}`);
      toast.success('Transaction deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete entry');
    }
  };

  const requestDelete = (id, entry = null) => {
    setDeleteConfirm({ open: true, id, entry });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm.id) return;
    const { id, entry } = deleteConfirm;
    setDeleteConfirm({ open: false, id: null, entry: null });
    await handleDelete(id, entry);
  };

  const openDetails = (tx) => {
    setDetailsModal({ open: true, tx });
  };

  const closeDetails = () => {
    setDetailsModal({ open: false, tx: null });
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    await logout();
  };

  const changeMonth = (direction) => {
    let newMonth = selectedMonth + direction;
    let newYear = selectedYear;
    
    // Allow going backward from current month (no restriction)
    if (newMonth < 1) {
      newMonth = 12;
      newYear--;
    } else if (newMonth > 12) {
      newMonth = 1;
      newYear++;
    }
    
    // No restriction on going backward - allow any month/year
    
    // Allow any year, just update
    setSelectedMonth(newMonth);
    setSelectedYear(newYear);
    setSearchParams({ month: newMonth, year: newYear });
  };

  // Reset category filter when the income/expense type toggle changes
  useEffect(() => {
    setCategoryFilter('all');
  }, [entryTypeFilter]);

  // Entries filtered to the selected type only
  const typedEntries = useMemo(() => {
    return entries.filter(e => (e.type || 'expense') === entryTypeFilter);
  }, [entries, entryTypeFilter]);

  // Stats computed from typedEntries (for cards, analytics, categories)
  const typedStats = useMemo(() => {
    const total = typedEntries.reduce((sum, e) => sum + (Number(e.total) || 0), 0);
    const categoryTotals = {};
    typedEntries.forEach(e => {
      const cat = (e.category || 'other').toLowerCase();
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(e.total) || 0);
    });
    const uniqueCategories = [...new Set(typedEntries.map(e => (e.category || 'other').toLowerCase()))];
    return { total, count: typedEntries.length, categories: uniqueCategories, categoryTotals };
  }, [typedEntries]);

  // Categories and receivers scoped to the selected type (for dropdowns and edit lists)
  const typedCategories = useMemo(() => {
    const usedCats = new Set(typedEntries.map(e => (e.category || 'other').toLowerCase()));
    return categories.filter(c => usedCats.has(c.toLowerCase()));
  }, [categories, typedEntries]);

  const typedReceivers = useMemo(() => {
    const usedRecs = new Set(
      typedEntries.map(e => (e.receiver || e.store || '').toLowerCase()).filter(Boolean)
    );
    return receivers.filter(r => usedRecs.has(r.toLowerCase()));
  }, [receivers, typedEntries]);

  // Table data: filter by category + search, then sort (used for display and Excel export)
  const tableData = useMemo(() => {
    let list = categoryFilter === 'all'
      ? typedEntries
      : typedEntries.filter((e) => e.category === categoryFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((entry) => {
        const receiverMatch = (entry.receiver || entry.store || '').toLowerCase().includes(q);
        const categoryMatch = (entry.category || '').toLowerCase().includes(q);
        const itemsMatch = (entry.items || []).some(
          (item) =>
            (item.name || '').toLowerCase().includes(q) ||
            String(item.amount || '').includes(q)
        );
        const notesMatch = (entry.notes || '').toLowerCase().includes(q);
        const amountMatch =
          String(entry.subtotal || '').includes(q) ||
          String(entry.tax || '').includes(q) ||
          String(entry.total || '').includes(q);
        return receiverMatch || categoryMatch || itemsMatch || notesMatch || amountMatch;
      });
    }
    const sorted = [...list].sort((a, b) => {
      const va = Number(a.total) || 0;
      const vb = Number(b.total) || 0;
      return transactionSort === 'largest' ? vb - va : va - vb;
    });
    return sorted;
  }, [typedEntries, categoryFilter, searchQuery, transactionSort]);

  const downloadTableAsExcel = () => {
    let sheetName;
    let fileName;
    if (viewMode === 'month') {
      const monthName = months[selectedMonth - 1];
      sheetName = `${monthName}_${selectedYear}`;
      fileName = `transactions_${monthName}_${selectedYear}.xlsx`;
    } else if (viewMode === 'year') {
      sheetName = String(selectedYear);
      fileName = `transactions_${selectedYear}.xlsx`;
    } else {
      sheetName = 'all';
      fileName = 'transactions_all.xlsx';
    }
    const rows = [
      ['Type', 'Receiver', 'Category', 'Items Summary', 'Subtotal', 'Tax', 'Total', 'Notes'],
      ...tableData.map((entry) => [
        entry.type === 'income' ? 'Income' : 'Expense',
        entry.receiver || entry.store || 'Unknown',
        entry.category || 'other',
        (entry.items || []).map((i) => `${i.name || ''} ($${Number(i.amount || 0).toFixed(2)})`).join('; '),
        Number(entry.subtotal || 0).toFixed(2),
        Number(entry.tax || 0).toFixed(2),
        Number(entry.total || 0).toFixed(2),
        entry.notes || ''
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.length > 31 ? sheetName.slice(0, 31) : sheetName);
    XLSX.writeFile(wb, fileName);
    toast.success('Table downloaded as Excel');
  };

  const renderTableRow = (entry) => {
    const cat = entry.category || 'other';
    const isIncome = entry.type === 'income';
    const catLower = cat.toLowerCase();
    let categoryColor = categoryColorMap[catLower];
    if (!categoryColor) {
      const usedColors = new Set(Object.values(categoryColorMap));
      for (const color of colorPalette) {
        if (!usedColors.has(color)) {
          categoryColor = color;
          break;
        }
      }
      if (!categoryColor) {
        const hue = Math.floor(Math.random() * 360);
        const saturation = 60 + Math.floor(Math.random() * 30);
        const lightness = 45 + Math.floor(Math.random() * 15);
        categoryColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
      }
      const newMap = { ...categoryColorMap, [catLower]: categoryColor };
      setCategoryColorMap(newMap);
      localStorage.setItem('categoryColorMap', JSON.stringify(newMap));
    }
    return (
      <tr
        key={entry._id || entry.id}
        className="transaction-row"
        onClick={() => openDetails(entry)}
      >
        <td>
          <div className={`transaction-type-pill ${isIncome ? 'income' : 'expense'}`}>
            {isIncome ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            <span>{isIncome ? 'Income' : 'Expense'}</span>
          </div>
        </td>
        <td>{entry.receiver || entry.store || 'Unknown'}</td>
        <td>
          <span
            className="category-badge"
            data-category={cat}
            style={{
              backgroundColor: categoryColor,
              background: categoryColor,
              color: 'white',
              border: 'none'
            }}
          >
            <Tag size={14} /> {cat}
          </span>
        </td>
        <td>
          <div className="items-list">
            {entry.items?.slice(0, 2).map((item, idx) => (
              <div key={idx} className="item-tag">
                {item.name} (${item.amount?.toFixed(2)})
              </div>
            ))}
            {entry.items?.length > 2 && (
              <div className="item-tag">+{entry.items.length - 2} more</div>
            )}
          </div>
        </td>
        <td>${entry.subtotal?.toFixed(2) || '0.00'}</td>
        <td>${entry.tax?.toFixed(2) || '0.00'}</td>
        <td className="total-cell">${entry.total?.toFixed(2) || '0.00'}</td>
        <td>
          <div className="table-actions">
            <button
              className="table-edit-button"
              onClick={(e) => {
                e.stopPropagation();
                sessionStorage.setItem('editEntry', JSON.stringify({
                  ...entry,
                  id: entry._id || entry.id,
                  month: entry.month || selectedMonth,
                  year: entry.year || selectedYear
                }));
                navigate(`/add-entry?edit=true&id=${entry._id || entry.id}&month=${selectedMonth}&year=${selectedYear}`);
              }}
              title="Edit transaction"
            >
              <Edit2 size={16} />
            </button>
            <button
              className="table-delete-button"
              onClick={(e) => {
                e.stopPropagation();
                requestDelete(entry._id || entry.id, entry);
              }}
              title="Delete transaction"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // Prepare chart data (scoped to selected type)
  const categoryChartData = useMemo(() => {
    if (!typedStats.categoryTotals) return [];
    return Object.entries(typedStats.categoryTotals).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      originalName: name.toLowerCase(),
      value: parseFloat(value.toFixed(2))
    })).sort((a, b) => b.value - a.value);
  }, [typedStats]);

  // Initialize selected categories when chart data changes (all selected by default)
  useEffect(() => {
    if (categoryChartData.length > 0) {
      const allCategoryNames = categoryChartData.map(cat => cat.originalName);
      // Always initialize all categories when data changes (new month/year)
      setSelectedCategories(new Set(allCategoryNames));
    } else {
      setSelectedCategories(new Set());
    }
  }, [categoryChartData]);

  // Filter chart data based on selected categories
  const filteredChartData = useMemo(() => {
    if (selectedCategories.size === 0) return categoryChartData;
    return categoryChartData.filter(cat => selectedCategories.has(cat.originalName));
  }, [categoryChartData, selectedCategories]);

  const toggleCategory = (categoryName) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(categoryName)) {
      newSelected.delete(categoryName);
    } else {
      newSelected.add(categoryName);
    }
    setSelectedCategories(newSelected);
  };

  // Get category color (wrapper to pass state)
  const getCategoryColor = useCallback((category) => {
    if (!category) return '#64748b';
    const catLower = (category || 'other').toLowerCase();
    // Check if we have the color in the map
    if (categoryColorMap[catLower]) {
      return categoryColorMap[catLower];
    }
    // Otherwise get it from the utility (which will assign and save)
    const color = getCategoryColorUtil(category, categoryColorMap, setCategoryColorMap);
    // Ensure we always return a valid color
    return color || '#64748b'; // Fallback to slate if somehow undefined
  }, [categoryColorMap]);

  const displayName = (() => {
    const backendName = user?.name;
    if (backendName && backendName !== 'User') return backendName;
    const firebaseName = auth.currentUser?.displayName;
    if (firebaseName && firebaseName.trim()) return firebaseName;
    return user?.email || 'User';
  })();

  const handleMrHamSend = async (e) => {
    e?.preventDefault?.();
    const trimmed = mrHamInput.trim();
    if (!trimmed) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      from: 'user',
      text: trimmed
    };
    setMrHamMessages((prev) => [...prev, userMessage]);
    setMrHamInput('');
    setMrHamLoading(true);

    try {
      const response = await api.post('/budget/chat', { question: trimmed });
      const answerText =
        response.data?.answer ||
        "I'm sorry, I couldn't find an answer about your data. Please try rephrasing your question.";

      const hamMessage = {
        id: `mrham-${Date.now()}`,
        from: 'mrham',
        text: answerText
      };
      setMrHamMessages((prev) => [...prev, hamMessage]);
    } catch (error) {
      console.error('Mr.Ham chat error:', error);
      toast.error('Mr. Ham could not answer right now. Please try again in a moment.');
      const hamMessage = {
        id: `mrham-error-${Date.now()}`,
        from: 'mrham',
        text:
          "I'm having trouble reaching your data right now. Please check your connection or try again shortly."
      };
      setMrHamMessages((prev) => [...prev, hamMessage]);
    } finally {
      setMrHamLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <nav className="dashboard-nav">
        <div className="nav-content">
          <div className="nav-brand">
            <a href="https://hamai.vercel.app" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: 'inherit' }}>
              <img 
                src="/hamai-logo.png" 
                alt="HamAI Logo" 
                className="nav-logo"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
              <h1 className="nav-title">HamAI</h1>
            </a>
          </div>
          <div className="nav-actions">
            <button
              type="button"
              className="nav-button nav-user-button"
              onClick={() => navigate('/profile')}
              title="Edit profile"
            >
              <User size={18} /> <span className="nav-user-name">{displayName}</span>
            </button>
            <ThemeToggle />
            <button type="button" className="nav-button nav-logout" onClick={() => setShowLogoutConfirm(true)}>
              <LogOut size={18} /> Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="dashboard-content">
        {/* View mode + Month/Year Navigation */}
        <div className="view-mode-bar">
          <div className="view-mode-tabs">
            <button
              type="button"
              className={`view-mode-tab ${viewMode === 'month' ? 'active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              Month
            </button>
            <button
              type="button"
              className={`view-mode-tab ${viewMode === 'year' ? 'active' : ''}`}
              onClick={() => setViewMode('year')}
            >
              Year
            </button>
            <button
              type="button"
              className={`view-mode-tab ${viewMode === 'overall' ? 'active' : ''}`}
              onClick={() => setViewMode('overall')}
            >
              Overall
            </button>
          </div>
          {viewMode === 'month' && (
            <div className="month-navigation">
              <button type="button" className="month-nav-button" onClick={() => changeMonth(-1)}>
                <ChevronLeft size={20} />
              </button>
              <div className="month-display">
                <h2>{months[selectedMonth - 1]} {selectedYear}</h2>
                <p className="month-subtitle">Viewing this month</p>
              </div>
              <button type="button" className="month-nav-button" onClick={() => changeMonth(1)}>
                <ChevronRight size={20} />
              </button>
              <div className="month-dropdown-wrapper">
                <button
                  type="button"
                  className="month-jump-select month-dropdown-trigger"
                  onClick={() => setMonthDropdownOpen((o) => !o)}
                  aria-expanded={monthDropdownOpen}
                  aria-haspopup="listbox"
                  aria-label="Select month"
                >
                  <span>{months[selectedMonth - 1]} {selectedYear}</span>
                  <ChevronDown size={18} className={monthDropdownOpen ? 'month-dropdown-chevron-open' : ''} />
                </button>
                {monthDropdownOpen && (
                  <>
                    <div
                      className="month-dropdown-backdrop"
                      role="presentation"
                      onClick={() => setMonthDropdownOpen(false)}
                      aria-hidden
                    />
                    <ul
                      className="month-dropdown-list"
                      role="listbox"
                      aria-label="Month"
                    >
                      {selectableMonths.map((opt) => (
                        <li
                          key={opt.value}
                          role="option"
                          aria-selected={selectedYear === opt.year && selectedMonth === opt.month}
                          className={`month-dropdown-option ${selectedYear === opt.year && selectedMonth === opt.month ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedYear(opt.year);
                            setSelectedMonth(opt.month);
                            setSearchParams({ month: opt.month, year: opt.year });
                            setMonthDropdownOpen(false);
                          }}
                        >
                          {opt.label}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
          {viewMode === 'year' && (
            <div className="year-navigation">
              <button type="button" className="month-nav-button" onClick={() => setSelectedYear((y) => y - 1)}>
                <ChevronLeft size={20} />
              </button>
              <div className="month-display">
                <h2>{selectedYear}</h2>
                <p className="month-subtitle">Viewing full year</p>
              </div>
              <button type="button" className="month-nav-button" onClick={() => setSelectedYear((y) => y + 1)}>
                <ChevronRight size={20} />
              </button>
              <select
                className="month-jump-select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {viewMode === 'overall' && (
            <div className="overall-display">
              <h2>All time</h2>
              <p className="month-subtitle">All your transactions</p>
            </div>
          )}
        </div>

        {!stats ? (
          <div className="empty-state">
            <p>
              {viewMode === 'month' && `No data for ${months[selectedMonth - 1]} ${selectedYear}`}
              {viewMode === 'year' && `No data for ${selectedYear}`}
              {viewMode === 'overall' && 'No transactions yet'}
            </p>
            <div className="empty-state-actions">
              <button type="button" className="primary-button primary-button-expense" onClick={() => navigate(`/add-entry?month=${selectedMonth}&year=${selectedYear}&type=expense`)}>
                <ArrowDownRight size={18} /> Add Expense
              </button>
              <button type="button" className="primary-button primary-button-income" onClick={() => navigate(`/add-entry?month=${selectedMonth}&year=${selectedYear}&type=income`)}>
                <ArrowUpRight size={18} /> Add Income
              </button>
              <button type="button" className="primary-button primary-button-bulk" onClick={() => navigate(`/batch-entry?month=${selectedMonth}&year=${selectedYear}`)}>
                <Layers size={18} /> Bulk Add
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Income / Expense Toggle */}
            <div className="entry-type-toggle">
              <button
                type="button"
                className={`entry-type-btn${entryTypeFilter === 'expense' ? ' active-expense' : ''}`}
                onClick={() => setEntryTypeFilter('expense')}
              >
                <ArrowDownRight size={16} /> Expenses
              </button>
              <button
                type="button"
                className={`entry-type-btn${entryTypeFilter === 'income' ? ' active-income' : ''}`}
                onClick={() => setEntryTypeFilter('income')}
              >
                <ArrowUpRight size={16} /> Income
              </button>
            </div>

            {/* Key Metrics */}
            <div className="stats-grid">
              <div className="stats-card">
                <div className="stat-item">
                  <DollarSign size={32} />
                  <div className="stat-content">
                    <p className="stat-label">{entryTypeFilter === 'expense' ? 'Total Spent' : 'Total Earned'}</p>
                    <p className="stat-value">${typedStats.total.toFixed(2)}</p>
                  </div>
                </div>
              </div>
              <div className="stats-card">
                <div className="stat-item">
                  <Calendar size={32} />
                  <div className="stat-content">
                    <p className="stat-label">Transactions</p>
                    <p className="stat-value">{typedStats.count}</p>
                  </div>
                </div>
              </div>
              <div className="stats-card">
                <div className="stat-item">
                  <Tag size={32} />
                  <div className="stat-content">
                    <p className="stat-label">Categories</p>
                    <p className="stat-value">{typedStats.categories.length}</p>
                  </div>
                </div>
              </div>
              <div className="stats-card">
                <div className="stat-item">
                  <TrendingUp size={32} />
                  <div className="stat-content">
                    <p className="stat-label">Avg per Transaction</p>
                    <p className="stat-value">
                      ${typedStats.count > 0 ? (typedStats.total / typedStats.count).toFixed(2) : '0.00'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="dashboard-tabs">
              <button
                className={`tab-button ${activeTab === 'table' ? 'active' : ''}`}
                onClick={() => setActiveTab('table')}
              >
                Table
              </button>
              <button
                className={`tab-button ${activeTab === 'analytics' ? 'active' : ''}`}
                onClick={() => setActiveTab('analytics')}
              >
                Analytics and Insights
              </button>
              <button
                className={`tab-button ${activeTab === 'categories' ? 'active' : ''}`}
                onClick={() => setActiveTab('categories')}
              >
                Categories
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'table' ? (
              <div className="table-section">
                <div className="table-header table-header-single-row">
                  <h2 className="table-section-title">Transactions</h2>
                  <div className="search-container table-search">
                    <Search size={16} className="search-icon" aria-hidden />
                    <input
                      type="search"
                      className="search-input"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Search transactions"
                    />
                  </div>
                  <div className="table-action-group">
                    <button
                      className="table-add-button table-add-button-expense"
                      onClick={() => navigate(`/add-entry?month=${selectedMonth}&year=${selectedYear}&type=expense`)}
                      type="button"
                      title="Record a new expense"
                    >
                      <Plus size={15} aria-hidden /> Add Expense
                    </button>
                    <button
                      className="table-add-button table-add-button-income"
                      onClick={() => navigate(`/add-entry?month=${selectedMonth}&year=${selectedYear}&type=income`)}
                      type="button"
                      title="Record a new income"
                    >
                      <Plus size={15} aria-hidden /> Add Income
                    </button>
                    <button
                      className="table-add-button table-add-button-bulk"
                      onClick={() => navigate(`/batch-entry?month=${selectedMonth}&year=${selectedYear}`)}
                      type="button"
                      title="Add multiple transactions across months using AI"
                    >
                      <Layers size={15} aria-hidden /> Bulk Add
                    </button>
                  </div>
                  <button
                    type="button"
                    className="table-download-excel"
                    onClick={downloadTableAsExcel}
                    disabled={tableData.length === 0}
                    title="Download this month's table as Excel"
                  >
                    <Download size={16} aria-hidden /> Download
                  </button>
                  <select
                    id="transaction-sort"
                    className="filter-select table-filter-select"
                    value={transactionSort}
                    onChange={(e) => setTransactionSort(e.target.value)}
                    aria-label="Sort by amount"
                    title="Sort by transaction amount"
                  >
                    <option value="largest">Largest first</option>
                    <option value="smallest">Smallest first</option>
                  </select>
                  <select
                    id="group-by-select"
                    className="filter-select table-filter-select"
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value)}
                    aria-label="Group by"
                  >
                    <option value="none">Group: None</option>
                    <option value="category">Group: Category</option>
                    <option value="receiver">Group: Receiver</option>
                  </select>
                  <select
                    id="category-filter-select"
                    className="filter-select table-filter-select"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    aria-label="Filter by category"
                  >
                    <option value="all">All</option>
                    {typedCategories.map(cat => (
                      <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                    ))}
                  </select>
                </div>

                {/* Entries Table */}
                {tableData.length === 0 ? (
                  <div className="empty-table-state">
                    <p>
                      {categoryFilter === 'all'
                        ? `No transactions found for ${months[selectedMonth - 1]} ${selectedYear}`
                        : `No transactions found in category "${categoryFilter}" for ${months[selectedMonth - 1]} ${selectedYear}`
                      }
                    </p>
                  </div>
                ) : (
                  <div className="entries-table-container">
                    <table className="entries-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Sender / Receiver</th>
                          <th>Category</th>
                          <th>Items</th>
                          <th>Subtotal</th>
                          <th>Tax</th>
                          <th>Total</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupBy === 'none'
                          ? tableData.map((entry) => renderTableRow(entry))
                          : (() => {
                              const keyFn = groupBy === 'category'
                                ? (e) => (e.category || 'other').toLowerCase()
                                : (e) => (e.receiver || e.store || 'Unknown').toLowerCase();
                              const groups = new Map();
                              tableData.forEach((entry) => {
                                const key = keyFn(entry);
                                if (!groups.has(key)) groups.set(key, []);
                                groups.get(key).push(entry);
                              });
                              const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
                              const rows = [];
                              sortedKeys.forEach((key) => {
                                rows.push(
                                  <tr key={`group-${key}`} className="table-group-header">
                                    <td colSpan={7}>
                                      {groupBy === 'category' ? key.charAt(0).toUpperCase() + key.slice(1) : key}
                                    </td>
                                  </tr>
                                );
                                groups.get(key).forEach((entry) => rows.push(renderTableRow(entry)));
                              });
                              return rows;
                            })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : activeTab === 'analytics' ? (
              <div className="analytics-section">
                {/* Category Pie Chart with Filter */}
                {categoryChartData.length > 0 && (
                  <div className="chart-card-large">
                    <div className="chart-header">
                      <PieChart size={24} />
                      <h3>{entryTypeFilter === 'expense' ? 'Expenses by Category' : 'Income by Category'}</h3>
                    </div>
                    <div className="chart-content-wrapper">
                      <div className="chart-checkboxes">
                        {categoryChartData.map((cat) => (
                          <label key={cat.originalName} className="category-checkbox-label">
                            <input
                              type="checkbox"
                              checked={selectedCategories.has(cat.originalName)}
                              onChange={() => toggleCategory(cat.originalName)}
                              className="category-checkbox"
                            />
                            <span 
                              className="category-checkbox-name"
                              style={{ 
                                color: getCategoryColor(cat.name),
                                fontWeight: selectedCategories.has(cat.originalName) ? 600 : 400
                              }}
                            >
                              {cat.name} (${cat.value.toFixed(2)})
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="chart-container">
                        {filteredChartData.length > 0 ? (
                          <ResponsiveContainer width="100%" height={400}>
                            <RechartsPieChart>
                              <Pie
                                data={filteredChartData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                outerRadius={140}
                                fill="#8884d8"
                                dataKey="value"
                              >
                                {filteredChartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={getCategoryColor(entry.name)} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                            </RechartsPieChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="chart-empty-state">
                            <p>Select at least one category to display the chart</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === 'categories' ? (
              <div className="categories-section">
                <div className="categories-content">
                  {/* Edit Categories Section */}
                  <div className="edit-section">
                    <h3>Edit {entryTypeFilter === 'expense' ? 'Expense' : 'Income'} Categories</h3>
                    <div className="editable-list">
                      {typedCategories.map(cat => (
                        <div key={cat} className="editable-list-item">
                          {editingItem?.type === 'category' && editingItem.oldValue === cat ? (
                            <input
                              type="text"
                              value={editingItem.newValue}
                              onChange={(e) => setEditingItem({ ...editingItem, newValue: e.target.value })}
                              onBlur={async () => {
                                if (editingItem.newValue && editingItem.newValue !== editingItem.oldValue) {
                                  try {
                                    const entriesToUpdate = entries.filter(e => e.category === editingItem.oldValue);
                                    await Promise.all(entriesToUpdate.map(e => 
                                      api.put(`/budget/${e._id || e.id}`, { category: editingItem.newValue })
                                    ));
                                    setCategories(categories.map(c => c === editingItem.oldValue ? editingItem.newValue : c));
                                    toast.success('Category updated');
                                  } catch (error) {
                                    toast.error('Failed to update category');
                                  }
                                }
                                setEditingItem(null);
                              }}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  e.target.blur();
                                }
                              }}
                              autoFocus
                              className="inline-edit-input"
                            />
                          ) : (
                            <span 
                              className="editable-text"
                              onClick={() => setEditingItem({ type: 'category', oldValue: cat, newValue: cat })}
                            >
                              <span 
                                className="category-color-indicator"
                                style={{ backgroundColor: getCategoryColor(cat) }}
                              />
                              {cat.charAt(0).toUpperCase() + cat.slice(1)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Edit Receiver Names Section */}
                  <div className="edit-section">
                    <h3>Edit {entryTypeFilter === 'expense' ? 'Receiver' : 'Sender'} Names</h3>
                    <div className="editable-list">
                      {typedReceivers.map(rec => (
                        <div key={rec} className="editable-list-item">
                          {editingItem?.type === 'receiver' && editingItem.oldValue === rec ? (
                            <input
                              type="text"
                              value={editingItem.newValue}
                              onChange={(e) => setEditingItem({ ...editingItem, newValue: e.target.value })}
                              onBlur={async () => {
                                if (editingItem.newValue && editingItem.newValue !== editingItem.oldValue) {
                                  try {
                                    const entriesToUpdate = entries.filter(e => (e.receiver || e.store) === editingItem.oldValue);
                                    await Promise.all(entriesToUpdate.map(e => 
                                      api.put(`/budget/${e._id || e.id}`, { receiver: editingItem.newValue, store: editingItem.newValue })
                                    ));
                                    setReceivers(receivers.map(r => r === editingItem.oldValue ? editingItem.newValue : r));
                                    toast.success('Receiver updated');
                                    fetchData();
                                  } catch (error) {
                                    toast.error('Failed to update receiver');
                                  }
                                }
                                setEditingItem(null);
                              }}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                  e.target.blur();
                                }
                              }}
                              autoFocus
                              className="inline-edit-input"
                            />
                          ) : (
                            <span 
                              className="editable-text"
                              onClick={() => setEditingItem({ type: 'receiver', oldValue: rec, newValue: rec })}
                            >
                              {rec}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Confirm dialogs */}
      {showLogoutConfirm && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-modal">
            <h3>Log out?</h3>
            <p>You’ll need to log in again to access your dashboard.</p>
            <div className="confirm-actions">
              <button className="confirm-secondary" onClick={() => setShowLogoutConfirm(false)} type="button">
                Cancel
              </button>
              <button className="confirm-danger" onClick={confirmLogout} type="button">
                Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm.open && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-modal">
            <h3>Delete this transaction?</h3>
            <p>This action can’t be undone.</p>
            <div className="confirm-actions">
              <button className="confirm-secondary" onClick={() => setDeleteConfirm({ open: false, id: null, entry: null })} type="button">
                Cancel
              </button>
              <button className="confirm-danger" onClick={confirmDelete} type="button">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        © {new Date().getFullYear()} Kaushik Alaguvadivel Ramya. All rights reserved.
      </footer>

      {detailsModal.open && detailsModal.tx && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" onClick={closeDetails}>
          <div className="details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="details-header">
              <h3>Transaction details</h3>
              <button className="details-close" onClick={closeDetails} type="button">×</button>
            </div>
            <div className="details-body">
              <div className="details-row">
                <span className="details-label">{detailsModal.tx.type === 'income' ? 'Sender' : 'Receiver'}</span>
                <span className="details-value">{detailsModal.tx.receiver || detailsModal.tx.store || 'Unknown'}</span>
              </div>
              <div className="details-row">
                <span className="details-label">Category</span>
                <span className="details-value">
                  <span
                    className="category-badge"
                    style={{ backgroundColor: getCategoryColor(detailsModal.tx.category), color: 'white' }}
                  >
                    <Tag size={14} /> {detailsModal.tx.category || 'other'}
                  </span>
                </span>
              </div>
              <div className="details-items">
                <div className="details-label">Items</div>
                <div className="details-items-list">
                  {(detailsModal.tx.items || []).map((it, idx) => (
                    <div key={idx} className="details-item">
                      <span>{it.name}</span>
                      <span>${Number(it.amount || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {detailsModal.tx.notes ? (
                <div className="details-row">
                  <span className="details-label">Notes</span>
                  <span className="details-value">{detailsModal.tx.notes}</span>
                </div>
              ) : null}
              <div className="details-totals">
                {detailsModal.tx.type === 'income' ? (
                  <>
                    <div className="details-item">
                      <span>Gross Income</span>
                      <span>${Number(detailsModal.tx.subtotal || 0).toFixed(2)}</span>
                    </div>
                    {Number(detailsModal.tx.stateTax || 0) > 0 && (
                      <div className="details-item">
                        <span>State Tax</span>
                        <span>-${Number(detailsModal.tx.stateTax || 0).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(detailsModal.tx.federalTax || 0) > 0 && (
                      <div className="details-item">
                        <span>Federal Tax</span>
                        <span>-${Number(detailsModal.tx.federalTax || 0).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(detailsModal.tx.stateTax || 0) === 0 && Number(detailsModal.tx.federalTax || 0) === 0 && Number(detailsModal.tx.tax || 0) > 0 && (
                      <div className="details-item">
                        <span>Tax</span>
                        <span>-${Number(detailsModal.tx.tax || 0).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="details-item details-total">
                      <span>Net Income</span>
                      <span>${Number(detailsModal.tx.total || 0).toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="details-item">
                      <span>Subtotal</span>
                      <span>${Number(detailsModal.tx.subtotal || 0).toFixed(2)}</span>
                    </div>
                    <div className="details-item">
                      <span>Tax</span>
                      <span>${Number(detailsModal.tx.tax || 0).toFixed(2)}</span>
                    </div>
                    <div className="details-item details-total">
                      <span>Total</span>
                      <span>${Number(detailsModal.tx.total || 0).toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mr. Ham chatbot */}
      <button
        type="button"
        className="mrham-launcher"
        onClick={() => setMrHamOpen((prev) => !prev)}
        aria-label={mrHamOpen ? 'Close Mr. Ham chat' : 'Open Mr. Ham chat'}
      >
        <span className="mrham-avatar">
          <img
            src="/hamai-logo.png"
            alt="Mr. Ham"
            className="mrham-avatar-img"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </span>
        <span className="mrham-launcher-text">Mr. Ham</span>
      </button>

      {mrHamOpen && (
        <div className="mrham-chat">
          <div className="mrham-header">
            <div className="mrham-header-info">
              <span className="mrham-avatar large">
                <img
                  src="/hamai-logo.png"
                  alt="Mr. Ham"
                  className="mrham-avatar-img"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </span>
              <div>
                <div className="mrham-name">Mr. Ham</div>
                <div className="mrham-subtitle">Your personal budget insights assistant</div>
              </div>
            </div>
            <button
              type="button"
              className="mrham-close"
              onClick={() => setMrHamOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>
          <div className="mrham-body">
            {mrHamMessages.map((msg) => (
              <div
                key={msg.id}
                className={`mrham-message ${
                  msg.from === 'mrham' ? 'mrham-message-assistant' : 'mrham-message-user'
                }`}
              >
                {msg.from === 'mrham' && <span className="mrham-message-label">Mr. Ham</span>}
                {msg.from === 'user' && <span className="mrham-message-label user">You</span>}
                <div className="mrham-message-text">
                  {msg.from === 'mrham' ? (
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  ) : (
                    msg.text
                  )}
                </div>
              </div>
            ))}
            {mrHamLoading && (
              <div className="mrham-message mrham-message-assistant">
                <span className="mrham-message-label">Mr. Ham</span>
                <div className="mrham-message-text mrham-typing">
                  Thinking...
                </div>
              </div>
            )}
          </div>
          <form className="mrham-input-bar" onSubmit={handleMrHamSend}>
            <input
              type="text"
              className="mrham-input"
              placeholder="Ask Mr. Ham about your spending..."
              value={mrHamInput}
              onChange={(e) => setMrHamInput(e.target.value)}
              disabled={mrHamLoading}
            />
            <button
              type="submit"
              className="mrham-send"
              disabled={mrHamLoading || !mrHamInput.trim()}
            >
              {mrHamLoading ? '...' : 'Ask'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
