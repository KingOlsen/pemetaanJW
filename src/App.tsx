/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { AuthPopupModal } from './components/AuthPopupModal';

interface DataRecord {
  id: string;
  type: 'user' | 'teacher' | 'class' | 'subject' | 'assignment' | 'level';
  name?: string;
  username?: string;
  role?: string;
  subject?: string;
  maxHours?: number;
  level?: string;
  class_id?: string;
  subject_id?: string;
  teacher_id?: string;
}

interface ModalConfig {
  isOpen: boolean;
  title: string;
  message: string;
  icon: string;
  confirmText: string;
  showPasswordPrompt: boolean;
  expectedPassword?: string;
  passwordLabel?: string;
  onConfirm: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
  visible: boolean;
}

declare global {
  interface Window {
    html2pdf?: () => {
      set: (opt: Record<string, unknown>) => {
        from: (el: HTMLElement | null) => {
          save: () => Promise<void>;
        };
      };
    };
  }
}

const STORAGE_KEY = 'sistem_jadual_data_premium';
const RECORDS_COLLECTION = 'records';

const TAB_TITLES: Record<number, { t: string; d: string }> = {
  1: { t: 'Daftar Sekolah Baru', d: 'Daftarkan kod serta nama sekolah baru di dalam sistem.' },
  2: { t: 'Log Masuk Portal', d: 'Masuk ke sekolah anda untuk mengurus jadual dan guru.' },
  3: { t: 'Senarai & Urus Guru', d: 'Kelola guru-guru yang aktif di dalam sistem database sekolah.' },
  4: { t: 'Peti Rekod Kelas', d: 'Senarai keseluruhan kelas mengikut klasifikasi Tahap 1, 2 & 3.' },
  5: { t: 'Pangkalan Mata Pelajaran', d: 'Kompilasi subjek pengajaran berserta peruntukan bilangan waktu.' },
  6: { t: 'Gandingan Matriks Pengajaran', d: 'Petakan guru bagi mata pelajaran kelas.' },
  7: { t: 'Laporan Rumusan Guru', d: 'Semak keseluruhan jumlah beban waktu mengajar bagi mengelakkan burnout.' },
  8: { t: 'Laporan Lengkap Kelas', d: 'Rumusan subjek dan guru yang diamanahkan bagi setiap bilik darjah.' },
  9: { t: 'Pemetaan Kelas PDF', d: 'Cetak slip visual A4 Landskap untuk edaran pentadbiran sekolah.' },
  10: { t: 'Pengurusan Tahap', d: 'Kelola pemetaan Tahap (Tahap 1, 2, 3) dan Tahun (Tahun 1 hingga 6) sekolah.' },
  11: { t: 'Pemetaan Guru PDF', d: 'Cetak slip visual A4 Landskap untuk edaran pentadbiran sekolah.' },
};

function sanitizeRecord(item: DataRecord): DataRecord {
  const safeId = String(item.id || Date.now())
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);

  const clean: DataRecord = {
    id: safeId,
    type: item.type,
  };

  if (item.name !== undefined) clean.name = String(item.name).slice(0, 200);
  if (item.username !== undefined) clean.username = String(item.username).slice(0, 200);
  if (item.role !== undefined) clean.role = String(item.role).slice(0, 200);
  if (item.subject !== undefined) clean.subject = String(item.subject).slice(0, 200);
  if (item.maxHours !== undefined) {
    const num = Number(item.maxHours);
    clean.maxHours = Number.isFinite(num) ? Math.min(Math.max(Math.round(num), 1), 100) : 30;
  }
  if (item.level !== undefined) {
    clean.level =
      item.level === 'Tahap 2' || item.level === 'Tahap 3' ? item.level : 'Tahap 1';
  }
  if (item.class_id !== undefined) clean.class_id = String(item.class_id).slice(0, 128);
  if (item.subject_id !== undefined) clean.subject_id = String(item.subject_id).slice(0, 128);
  if (item.teacher_id !== undefined) clean.teacher_id = String(item.teacher_id).slice(0, 128);

  return clean;
}

export default function App() {
  const [allData, setAllData] = useState<DataRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<DataRecord | null>(null);
  const [editingItem, setEditingItem] = useState<DataRecord | null>(null);
  const [currentTab, setCurrentTab] = useState<number>(2);
  const [headerTitle, setHeaderTitle] = useState<string>('Sistem Pemetaan Jadual');
  const [headerDesc, setHeaderDesc] = useState<string>(
    'Sila daftarkan maklumat sekolah atau log masuk ke sekolah sedia ada.'
  );

  const initialRouteResolvedRef = useRef(false);
  const migratedLocalRef = useRef(false);

  // Section 1: User (School) Registration Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [savingUser, setSavingUser] = useState(false);

  // Centered Animated Login & Sign Up Popup State (shown automatically on open)
  const [authPopupOpen, setAuthPopupOpen] = useState<boolean>(true);
  const [authPopupMode, setAuthPopupMode] = useState<'login' | 'signup'>('login');

  // Section 2: Login Form State
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loginSchoolCode, setLoginSchoolCode] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const loginPasswordRef = useRef<HTMLInputElement>(null);

  // Section 3: Teacher Form & Search State
  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherShortname, setNewTeacherShortname] = useState('');
  const [newTeacherMaxHours, setNewTeacherMaxHours] = useState('30');
  const [savingTeacher, setSavingTeacher] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');

  // Section 4: Class Form State
  const [showClassForm, setShowClassForm] = useState(false);
  const [newClassYear, setNewClassYear] = useState('Tahun 1');
  const [newClassLevel, setNewClassLevel] = useState('Tahap 1');
  const [newClassName, setNewClassName] = useState('');
  const [newClassShortname, setNewClassShortname] = useState('');
  const [newClassTeacher, setNewClassTeacher] = useState('');
  const [savingClass, setSavingClass] = useState(false);

  // Section 5: Subject Form State
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectShortname, setNewSubjectShortname] = useState('');
  const [newSubjectTimeT1, setNewSubjectTimeT1] = useState('');
  const [newSubjectTimeT2, setNewSubjectTimeT2] = useState('');
  const [newSubjectTimeT3, setNewSubjectTimeT3] = useState('');
  const [savingSubject, setSavingSubject] = useState(false);

  // Section 10: Level (Pengurusan Tahap) Form State
  const [showLevelForm, setShowLevelForm] = useState(false);
  const [newLevelTahap, setNewLevelTahap] = useState('Tahap 1');
  const [newLevelTahun, setNewLevelTahun] = useState('Tahun 1');
  const [savingLevel, setSavingLevel] = useState(false);

  // Section 6: Second & third teacher slot toggles per (class_id + subject_id) cell
  const [expandedSecondTeacherCells, setExpandedSecondTeacherCells] = useState<
    Record<string, boolean>
  >({});
  const [expandedThirdTeacherCells, setExpandedThirdTeacherCells] = useState<
    Record<string, boolean>
  >({});

  // Section 9: PDF Export Spinner & A4 Landscape Auto-Fit State
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [printScale, setPrintScale] = useState(1);
  const printPreviewRef = useRef<HTMLDivElement>(null);
  const printContentRef = useRef<HTMLDivElement>(null);

  // Custom Modal State
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    title: 'Sahkan Tindakan',
    message: 'Adakah anda pasti mahu meneruskan tindakan ini?',
    icon: '⚠️',
    confirmText: 'Sahkan',
    showPasswordPrompt: false,
    onConfirm: () => {},
  });
  const [modalPassword, setModalPassword] = useState('');
  const [modalPasswordError, setModalPasswordError] = useState(false);
  const modalPasswordRef = useRef<HTMLInputElement>(null);

  // Toast State
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const switchTab = (tabNumber: number) => {
    setCurrentTab(tabNumber);
    if (TAB_TITLES[tabNumber]) {
      setHeaderTitle(TAB_TITLES[tabNumber].t);
      setHeaderDesc(TAB_TITLES[tabNumber].d);
    }
  };

  // Real-time cloud sync via Firestore onSnapshot + LocalStorage cache/migration
  useEffect(() => {
    const localRaw = localStorage.getItem(STORAGE_KEY);
    let localParsed: DataRecord[] = [];
    if (localRaw) {
      try {
        localParsed = JSON.parse(localRaw);
        setAllData(localParsed);
      } catch (e) {
        console.error('Gagal menghuraikan data storan lokal:', e);
      }
    }

    const q = query(
      collection(db, RECORDS_COLLECTION),
      where('type', 'in', ['user', 'teacher', 'class', 'subject', 'assignment', 'level'])
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const cloudRecords: DataRecord[] = [];
        snapshot.forEach((docSnap) => {
          cloudRecords.push(docSnap.data() as DataRecord);
        });

        // If cloud is empty on first sync but this device has local data, migrate local data to cloud
        if (cloudRecords.length === 0 && localParsed.length > 0 && !migratedLocalRef.current) {
          migratedLocalRef.current = true;
          try {
            for (const item of localParsed) {
              const sanitized = sanitizeRecord(item);
              await setDoc(doc(db, RECORDS_COLLECTION, sanitized.id), sanitized);
            }
            return;
          } catch (err) {
            console.error('Ralat migrasi storan lokal ke awan:', err);
          }
        }

        setAllData(cloudRecords);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudRecords));

        setCurrentUser((prevUser) => {
          if (!prevUser) return null;
          const updatedSelf = cloudRecords.find((r) => r.id === prevUser.id && r.type === 'user');
          return updatedSelf || prevUser;
        });

        if (!initialRouteResolvedRef.current) {
          initialRouteResolvedRef.current = true;
          const users = cloudRecords.filter((d) => d.type === 'user');
          if (users.length === 0) {
            switchTab(1);
            setAuthPopupMode('signup');
          } else {
            switchTab(2);
            setAuthPopupMode('login');
          }
        }
      },
      (error) => {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.toLowerCase().includes('quota') || errMsg.includes('resource-exhausted')) {
          if (!initialRouteResolvedRef.current) {
            initialRouteResolvedRef.current = true;
            const users = localParsed.filter((d) => d.type === 'user');
            switchTab(users.length === 0 ? 1 : 2);
          }
          showMessage(
            'Had bacaan harian Firestore telah penuh. Data cache lokal dipaparkan buat sementara.',
            'error'
          );
          return;
        }
        try {
          handleFirestoreError(error, OperationType.LIST, RECORDS_COLLECTION);
        } catch {
          showMessage('Ralat penyelarasan pangkalan data awan', 'error');
        }
      }
    );

    return () => unsubscribe();
  }, []);

  // Cloud SDK operations with optimistic state + localStorage backup
  const createRecord = async (item: DataRecord): Promise<{ isOk: boolean }> => {
    const clean = sanitizeRecord(item);
    setAllData((prev) => {
      const next = [...prev.filter((d) => d.id !== clean.id), clean];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    try {
      await setDoc(doc(db, RECORDS_COLLECTION, clean.id), clean);
      return { isOk: true };
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.CREATE, `${RECORDS_COLLECTION}/${clean.id}`);
      } catch {
        return { isOk: false };
      }
    }
  };

  const updateRecord = async (item: DataRecord): Promise<{ isOk: boolean }> => {
    const clean = sanitizeRecord(item);
    setAllData((prev) => {
      const next = prev.map((d) => (d.id === clean.id ? clean : d));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    try {
      await setDoc(doc(db, RECORDS_COLLECTION, clean.id), clean);
      return { isOk: true };
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.UPDATE, `${RECORDS_COLLECTION}/${clean.id}`);
      } catch {
        return { isOk: false };
      }
    }
  };

  const deleteRecord = async (item: DataRecord): Promise<{ isOk: boolean }> => {
    setAllData((prev) => {
      const next = prev.filter((d) => d.id !== item.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    try {
      await deleteDoc(doc(db, RECORDS_COLLECTION, item.id));
      return { isOk: true };
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.DELETE, `${RECORDS_COLLECTION}/${item.id}`);
      } catch {
        return { isOk: false };
      }
    }
  };

  const showMessage = (message: string, type: 'success' | 'error') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, visible: false }]);

    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: true } : t)));
    }, 50);

    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)));
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 4000);
  };

  const openModal = ({
    title,
    message,
    icon = '⚠️',
    confirmText = 'Sahkan',
    showPasswordPrompt = false,
    expectedPassword,
    passwordLabel,
    onConfirm,
  }: {
    title: string;
    message: string;
    icon?: string;
    confirmText?: string;
    showPasswordPrompt?: boolean;
    expectedPassword?: string;
    passwordLabel?: string;
    onConfirm: () => void;
  }) => {
    setModalPassword('');
    setModalPasswordError(false);
    setModal({
      isOpen: true,
      title,
      message,
      icon,
      confirmText,
      showPasswordPrompt,
      expectedPassword,
      passwordLabel,
      onConfirm,
    });
    if (showPasswordPrompt) {
      setTimeout(() => modalPasswordRef.current?.focus(), 100);
    }
  };

  const handleModalConfirm = () => {
    if (modal.showPasswordPrompt) {
      const enteredPass = modalPassword.trim();
      if (modal.expectedPassword !== undefined) {
        if (!enteredPass || enteredPass !== modal.expectedPassword) {
          setModalPasswordError(true);
          setModalPassword('');
          modalPasswordRef.current?.focus();
          return;
        }
      } else {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const todayPassword = `${dd}${mm}${yyyy}`;

        if (enteredPass !== todayPassword) {
          setModalPasswordError(true);
          setModalPassword('');
          modalPasswordRef.current?.focus();
          return;
        }
      }
    }

    modal.onConfirm();
    setModal((prev) => ({ ...prev, isOpen: false }));
  };

  const navigateToSecuredTab = (tabNumber: number) => {
    if (!currentUser) {
      showMessage('🔒 Akses Terhad. Sila log masuk ke profil sekolah anda terlebih dahulu.', 'error');
      switchTab(2);
      setAuthPopupMode('login');
      setAuthPopupOpen(true);
      return;
    }
    switchTab(tabNumber);
  };

  const handlePopupLogin = ({
    selectedUserId: popupSelectedId,
    schoolCode,
    password,
  }: {
    selectedUserId: string;
    schoolCode: string;
    password: string;
  }): { ok: boolean; error?: string } => {
    const trimmedCode = schoolCode.trim().toUpperCase();
    const user =
      (popupSelectedId
        ? allData.find((u) => u.type === 'user' && u.id === popupSelectedId)
        : undefined) ||
      (trimmedCode
        ? allData.find(
            (u) =>
              u.type === 'user' &&
              ((u.name || '').toUpperCase() === trimmedCode ||
                (u.username || '').toUpperCase() === trimmedCode ||
                `${(u.name || '').toUpperCase()} - ${(u.username || '').toUpperCase()}` ===
                  trimmedCode)
          )
        : undefined);

    if (!popupSelectedId && !trimmedCode) {
      return {
        ok: false,
        error: 'Sila masukkan kod sekolah atau pilih sekolah anda daripada senarai.',
      };
    }

    if (!user) {
      return {
        ok: false,
        error: 'Kod sekolah tidak dijumpai. Sila semak semula atau daftar sekolah baharu.',
      };
    }

    const trimmedPass = password.trim();
    if (!trimmedPass) {
      return { ok: false, error: 'Sila masukkan kata laluan sekolah.' };
    }

    if (user.role !== trimmedPass) {
      return {
        ok: false,
        error: 'Kata laluan salah. Sila semak semula kata laluan sekolah anda.',
      };
    }

    setCurrentUser(user);
    setSelectedUserId(user.id);
    setLoginSchoolCode(user.name || '');
    setLoginPassword('');
    setLoginError(false);
    setAuthPopupOpen(false);
    showMessage('🔑 Log masuk berjaya!', 'success');

    setTimeout(() => {
      switchTab(6);
    }, 350);

    return { ok: true };
  };

  const handlePopupSignUp = async ({
    schoolCode,
    schoolName,
    password,
  }: {
    schoolCode: string;
    schoolName: string;
    password: string;
  }): Promise<{ ok: boolean; error?: string; createdUser?: DataRecord }> => {
    const name = schoolCode.trim().toUpperCase();
    const username = schoolName.trim().toUpperCase();
    const pass = password.trim();

    if (!name || !username || !pass) {
      return { ok: false, error: 'Semua ruangan maklumat wajib diisi.' };
    }

    const exists = allData.some(
      (d) => d.type === 'user' && (d.name || '').toUpperCase() === name
    );
    if (exists) {
      return { ok: false, error: `Kod sekolah ${name} sudah didaftarkan.` };
    }

    const createdUser: DataRecord = {
      id: Date.now().toString(),
      type: 'user',
      name,
      username,
      role: pass,
    };

    const result = await createRecord(createdUser);
    if (result.isOk) {
      showMessage('Pendaftaran sekolah berjaya!', 'success');
      return { ok: true, createdUser };
    }
    return { ok: false, error: 'Pendaftaran sekolah gagal. Sila cuba lagi.' };
  };

  const handleLogin = () => {
    setLoginError(false);

    const trimmedCode = loginSchoolCode.trim().toUpperCase();
    const user =
      (selectedUserId ? allData.find((u) => u.type === 'user' && u.id === selectedUserId) : undefined) ||
      (trimmedCode
        ? allData.find(
            (u) =>
              u.type === 'user' &&
              ((u.name || '').toUpperCase() === trimmedCode ||
                (u.username || '').toUpperCase() === trimmedCode ||
                `${(u.name || '').toUpperCase()} - ${(u.username || '').toUpperCase()}` ===
                  trimmedCode)
          )
        : undefined);

    if (!selectedUserId && !trimmedCode) {
      showMessage('Sila masukkan kod sekolah atau pilih sekolah anda dari senarai', 'error');
      return;
    }

    if (!user) {
      showMessage('Kod sekolah tidak dijumpai. Sila semak semula.', 'error');
      return;
    }

    const password = loginPassword.trim();
    if (!password) {
      showMessage('Sila masukkan kata laluan', 'error');
      return;
    }

    if (user.role !== password) {
      setLoginError(true);
      setLoginPassword('');
      loginPasswordRef.current?.focus();
      return;
    }

    setCurrentUser(user);
    setSelectedUserId(user.id);
    setLoginSchoolCode(user.name || '');
    setLoginPassword('');
    setAuthPopupOpen(false);
    showMessage('🔑 Log masuk berjaya!', 'success');

    setTimeout(() => {
      switchTab(6);
    }, 500);
  };

  const performLogout = () => {
    setCurrentUser(null);
    setSelectedUserId('');
    setLoginSchoolCode('');
    hideForm('user');
    hideForm('teacher');
    hideForm('class');
    hideForm('subject');
    hideForm('level');
    switchTab(2);
    setAuthPopupMode('login');
    setAuthPopupOpen(true);
    showMessage('Log keluar berjaya.', 'success');
  };

  const handleLogout = () => {
    openModal({
      title: 'Sahkan Log Keluar',
      message:
        'Adakah anda pasti mahu mendaftar keluar daripada profil sekolah anda? Sebarang perubahan yang telah dibuat telah disimpan secara automatik.',
      icon: '🔑',
      confirmText: 'Log Keluar',
      onConfirm: () => {
        performLogout();
      },
    });
  };

  const clearForm = (type: 'user' | 'teacher' | 'class' | 'subject' | 'level') => {
    setEditingItem(null);
    if (type === 'user') {
      setNewUserName('');
      setNewUserUsername('');
      setNewUserPassword('');
    } else if (type === 'teacher') {
      setNewTeacherName('');
      setNewTeacherShortname('');
      setNewTeacherMaxHours('30');
    } else if (type === 'class') {
      setNewClassYear('Tahun 1');
      setNewClassLevel('Tahap 1');
      setNewClassName('');
      setNewClassShortname('');
      setNewClassTeacher('');
    } else if (type === 'subject') {
      setNewSubjectName('');
      setNewSubjectShortname('');
      setNewSubjectTimeT1('');
      setNewSubjectTimeT2('');
      setNewSubjectTimeT3('');
    } else if (type === 'level') {
      setNewLevelTahap('Tahap 1');
      setNewLevelTahun('Tahun 1');
    }
  };

  const showForm = (type: 'user' | 'teacher' | 'class' | 'subject' | 'level') => {
    if (!currentUser && type !== 'user') {
      showMessage('Akses disekat. Sila log masuk dahulu.', 'error');
      return;
    }
    if (type === 'teacher') setShowTeacherForm(true);
    if (type === 'class') setShowClassForm(true);
    if (type === 'subject') setShowSubjectForm(true);
    if (type === 'level') setShowLevelForm(true);
  };

  const hideForm = (type: 'user' | 'teacher' | 'class' | 'subject' | 'level') => {
    if (type === 'teacher') setShowTeacherForm(false);
    if (type === 'class') setShowClassForm(false);
    if (type === 'subject') setShowSubjectForm(false);
    if (type === 'level') setShowLevelForm(false);
    clearForm(type);
  };

  const openAddForm = (type: 'teacher' | 'class' | 'subject' | 'level') => {
    setEditingItem(null);
    clearForm(type);
    showForm(type);
  };

  const resolveTahapFromTahun = (tahun: string): string => {
    const configuredLevel = allData.find(
      (d) =>
        d.type === 'level' &&
        currentUser &&
        d.username === currentUser.id &&
        d.role === tahun
    );
    if (configuredLevel && (configuredLevel.level || configuredLevel.name)) {
      return configuredLevel.level || configuredLevel.name || 'Tahap 1';
    }
    return ['Tahun 4', 'Tahun 5', 'Tahun 6'].includes(tahun) ? 'Tahap 2' : 'Tahap 1';
  };

  const saveUser = async () => {
    const name = newUserName.trim().toUpperCase();
    const username = newUserUsername.trim().toUpperCase();
    const password = newUserPassword.trim();

    if (!name || !username || !password) {
      showMessage('Semua ruangan maklumat wajib diisi', 'error');
      return;
    }

    const exists = allData.some((d) => d.type === 'user' && d.name === name);
    if (exists && !editingItem) {
      showMessage('Ralat: Kod sekolah ini sudah didaftarkan!', 'error');
      return;
    }

    setSavingUser(true);

    if (editingItem) {
      const updated: DataRecord = {
        ...editingItem,
        name,
        username,
        role: password,
      };
      const result = await updateRecord(updated);
      if (result.isOk) {
        if (currentUser && currentUser.id === editingItem.id) {
          setCurrentUser(updated);
        }
        showMessage('Profil sekolah berjaya dikemaskini', 'success');
        hideForm('user');
      } else {
        showMessage('Gagal mengemaskini profil sekolah', 'error');
      }
    } else {
      const result = await createRecord({
        id: Date.now().toString(),
        type: 'user',
        name,
        username,
        role: password,
      });

      if (result.isOk) {
        showMessage('Pendaftaran sekolah berjaya!', 'success');
        hideForm('user');
        switchTab(2);
      } else {
        showMessage('Pendaftaran sekolah gagal', 'error');
      }
    }

    setSavingUser(false);
  };

  const saveTeacher = async () => {
    if (!currentUser) return;
    const name = newTeacherName.trim().toUpperCase();
    const shortname = newTeacherShortname.trim().toUpperCase();
    const maxHours = parseInt(newTeacherMaxHours, 10) || 30;

    if (!name || !shortname) {
      showMessage('Sila isi maklumat nama dan kod singkatan', 'error');
      return;
    }

    setSavingTeacher(true);

    if (editingItem) {
      const updated: DataRecord = {
        ...editingItem,
        name,
        subject: shortname,
        maxHours,
      };
      const result = await updateRecord(updated);
      if (result.isOk) {
        showMessage('Maklumat guru dikemaskini', 'success');
        hideForm('teacher');
      } else {
        showMessage('Gagal kemaskini', 'error');
      }
    } else {
      const result = await createRecord({
        id: Date.now().toString(),
        type: 'teacher',
        name,
        subject: shortname,
        maxHours,
        username: currentUser.id,
      });

      if (result.isOk) {
        showMessage('Guru berjaya didaftarkan', 'success');
        hideForm('teacher');
      } else {
        showMessage('Ralat pendaftaran guru', 'error');
      }
    }

    setSavingTeacher(false);
  };

  const saveClass = async () => {
    if (!currentUser) return;
    const year = newClassYear || 'Tahun 1';
    const name = newClassName.trim().toUpperCase();
    const shortname = newClassShortname.trim().toUpperCase();
    const teacherId = newClassTeacher;
    const level = newClassLevel || resolveTahapFromTahun(year);

    if (!name) {
      showMessage('Sila masukkan nama kelas', 'error');
      return;
    }

    setSavingClass(true);

    if (editingItem) {
      const updated: DataRecord = {
        ...editingItem,
        name,
        subject: shortname,
        class_id: year,
        role: teacherId,
        level,
      };
      const result = await updateRecord(updated);
      if (result.isOk) {
        showMessage('Rekod kelas berjaya diubah', 'success');
        hideForm('class');
      } else {
        showMessage('Ralat kemaskini kelas', 'error');
      }
    } else {
      const result = await createRecord({
        id: Date.now().toString(),
        type: 'class',
        name,
        subject: shortname,
        class_id: year,
        role: teacherId,
        level,
        username: currentUser.id,
      });

      if (result.isOk) {
        showMessage('Kelas baharu didaftarkan', 'success');
        hideForm('class');
      } else {
        showMessage('Ralat pendaftaran kelas', 'error');
      }
    }

    setSavingClass(false);
  };

  const saveSubject = async () => {
    if (!currentUser) return;
    const name = newSubjectName.trim().toUpperCase();
    const shortname = newSubjectShortname.trim().toUpperCase();
    const timeT1 = newSubjectTimeT1.trim();
    const timeT2 = newSubjectTimeT2.trim();
    const timeT3 = newSubjectTimeT3.trim();

    if (!name || !timeT1 || !timeT2 || !timeT3) {
      showMessage('Sila pastikan semua ruangan waktu lengkap diisi', 'error');
      return;
    }

    setSavingSubject(true);

    if (editingItem) {
      const updated: DataRecord = {
        ...editingItem,
        name,
        class_id: shortname,
        role: timeT1,
        subject: timeT2,
        subject_id: timeT3,
      };
      const result = await updateRecord(updated);
      if (result.isOk) {
        showMessage('Mata pelajaran berjaya dikemaskini', 'success');
        hideForm('subject');
      } else {
        showMessage('Ralat pengemaskinian subjek', 'error');
      }
    } else {
      const result = await createRecord({
        id: Date.now().toString(),
        type: 'subject',
        name,
        class_id: shortname,
        role: timeT1,
        subject: timeT2,
        subject_id: timeT3,
        username: currentUser.id,
      });

      if (result.isOk) {
        showMessage('Mata pelajaran berjaya dimasukkan', 'success');
        hideForm('subject');
      } else {
        showMessage('Ralat pendaftaran mata pelajaran', 'error');
      }
    }

    setSavingSubject(false);
  };

  const saveLevel = async () => {
    if (!currentUser) return;
    const tahap = newLevelTahap;
    const tahun = newLevelTahun;

    if (!tahap || !tahun) {
      showMessage('Sila pilih Tahap dan Tahun', 'error');
      return;
    }

    setSavingLevel(true);

    if (editingItem) {
      const updated: DataRecord = {
        ...editingItem,
        name: tahap,
        role: tahun,
        level: tahap,
      };
      const result = await updateRecord(updated);
      if (result.isOk) {
        showMessage('Rekod tahap berjaya dikemaskini', 'success');
        hideForm('level');
      } else {
        showMessage('Ralat kemaskini tahap', 'error');
      }
    } else {
      const result = await createRecord({
        id: Date.now().toString(),
        type: 'level',
        name: tahap,
        role: tahun,
        level: tahap,
        username: currentUser.id,
      });

      if (result.isOk) {
        showMessage('Rekod tahap berjaya didaftarkan', 'success');
        hideForm('level');
      } else {
        showMessage('Ralat pendaftaran tahap', 'error');
      }
    }

    setSavingLevel(false);
  };

  const editItem = (
    type: 'users' | 'teachers' | 'classes' | 'subjects' | 'levels',
    id: string
  ) => {
    const item = allData.find((d) => d.id === id);
    if (!item) return;

    if (type === 'users') {
      openModal({
        title: '🔒 Kebenaran Diperlukan',
        message: `Sila masukkan Kata Laluan Pentadbir untuk menyunting rekod sekolah "${item.name}".`,
        icon: '🔒',
        confirmText: 'Sahkan Kata Laluan',
        showPasswordPrompt: true,
        onConfirm: () => {
          setEditingItem(item);
          setNewUserName(item.name || '');
          setNewUserUsername(item.username || '');
          setNewUserPassword(item.role || '');
          showForm('user');
          switchTab(1);
          showMessage('🔓 Akses dibenarkan! Borang suntingan sekolah sedia digunakan.', 'success');
        },
      });
    } else if (type === 'teachers') {
      setEditingItem(item);
      setNewTeacherName(item.name || '');
      setNewTeacherShortname(item.subject || '');
      setNewTeacherMaxHours(String(item.maxHours || 30));
      showForm('teacher');
    } else if (type === 'classes') {
      setEditingItem(item);
      const firstDigit = (item.name || '').trim().charAt(0);
      const inferredYear = ['1', '2', '3', '4', '5', '6'].includes(firstDigit)
        ? `Tahun ${firstDigit}`
        : item.level === 'Tahap 2'
        ? 'Tahun 4'
        : 'Tahun 1';
      const resolvedYear = item.class_id || inferredYear;
      setNewClassYear(resolvedYear);
      setNewClassLevel(item.level || resolveTahapFromTahun(resolvedYear));
      setNewClassName(item.name || '');
      setNewClassShortname(item.subject || '');
      setNewClassTeacher(item.role || '');
      showForm('class');
    } else if (type === 'subjects') {
      setEditingItem(item);
      setNewSubjectName(item.name || '');
      setNewSubjectShortname(item.class_id || '');
      setNewSubjectTimeT1(item.role || '');
      setNewSubjectTimeT2(item.subject || '');
      setNewSubjectTimeT3(item.subject_id || '0');
      showForm('subject');
    } else if (type === 'levels') {
      setEditingItem(item);
      setNewLevelTahap(item.level || item.name || 'Tahap 1');
      setNewLevelTahun(item.role || 'Tahun 1');
      showForm('level');
    }
  };

  const confirmDeleteItem = (id: string, name: string) => {
    const targetItem = allData.find((d) => d.id === id);
    const isUserAccount = targetItem?.type === 'user';

    openModal({
      title: isUserAccount ? '🔒 Pengesahan Kata Laluan Akaun' : 'Sahkan Padam Rekod',
      message: isUserAccount
        ? `Sila masukkan kata laluan bagi akaun sekolah "${name}" (${targetItem?.username || ''}) sebelum memadam data sekolah ini.`
        : `Adakah anda pasti mahu memadam rekod "${name}"? Sebarang maklumat berkait mungkin akan terjejas.`,
      icon: '🗑️',
      confirmText: 'Padam',
      showPasswordPrompt: isUserAccount,
      expectedPassword: isUserAccount ? targetItem?.role || '' : undefined,
      passwordLabel: isUserAccount ? 'Kata Laluan Akaun Sekolah' : undefined,
      onConfirm: async () => {
        const item = allData.find((d) => d.id === id);
        if (!item) return;
        if (item.type === 'user') {
          const relatedRecords = allData.filter((d) => d.username === item.id);
          for (const rel of relatedRecords) {
            await deleteRecord(rel);
          }
          if (currentUser?.id === item.id) {
            setCurrentUser(null);
          }
        }
        const result = await deleteRecord(item);
        if (result.isOk) {
          showMessage('Rekod berjaya dipadam', 'success');
        } else {
          showMessage('Ralat memadam rekod', 'error');
        }
      },
    });
  };

  const updateAssignment = async (
    classId: string,
    subjectId: string,
    teacherId: string,
    slot: 1 | 2 | 3 = 1
  ) => {
    if (!currentUser) {
      showMessage('Akses disekat. Sila log masuk dahulu.', 'error');
      return;
    }

    const cellKey = `${classId}_${subjectId}`;
    const existing = allData.find(
      (a) =>
        a.type === 'assignment' &&
        a.class_id === classId &&
        a.subject_id === subjectId &&
        a.username === currentUser.id
    );

    if (slot === 1) {
      if (teacherId === '') {
        if (existing) {
          if (existing.role || existing.subject) {
            // Promote remaining teachers up when first teacher is cleared
            const nextT1 = existing.role || existing.subject || '';
            const nextT2 = existing.role ? existing.subject || '' : '';
            const updated: DataRecord = {
              ...existing,
              teacher_id: nextT1,
              role: nextT2,
              subject: '',
            };
            await updateRecord(updated);
            if (!nextT2) {
              setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
            }
            setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
          } else {
            await deleteRecord(existing);
            setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
            setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
          }
        }
        return;
      }

      if (existing) {
        const updated: DataRecord = { ...existing, teacher_id: teacherId };
        const result = await updateRecord(updated);
        if (result.isOk) {
          showMessage('💾 Gandingan jadual berjaya dikemaskini', 'success');
        } else {
          showMessage('Ralat mengemaskini tugasan', 'error');
        }
      } else {
        const newAssign: DataRecord = {
          id: Date.now().toString(),
          type: 'assignment',
          class_id: classId,
          subject_id: subjectId,
          teacher_id: teacherId,
          role: '',
          subject: '',
          username: currentUser.id,
        };
        const result = await createRecord(newAssign);
        if (result.isOk) {
          showMessage('💾 Gandingan jadual berjaya dipetakan', 'success');
        } else {
          showMessage('Ralat pemetaan tugasan baru', 'error');
        }
      }
    } else if (slot === 2) {
      // slot === 2 (Guru Kedua -> role)
      if (teacherId === '') {
        if (existing) {
          if (existing.subject) {
            // Promote third teacher to second slot
            const updated: DataRecord = {
              ...existing,
              role: existing.subject,
              subject: '',
            };
            await updateRecord(updated);
            setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
          } else if (existing.teacher_id) {
            const updated: DataRecord = { ...existing, role: '' };
            await updateRecord(updated);
            setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
            setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
          } else {
            await deleteRecord(existing);
            setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
            setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
          }
        } else {
          setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
          setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
        }
        return;
      }

      if (existing) {
        const updated: DataRecord = { ...existing, role: teacherId };
        const result = await updateRecord(updated);
        if (result.isOk) {
          showMessage('💾 Guru kedua berjaya dipetakan', 'success');
        } else {
          showMessage('Ralat mengemaskini guru kedua', 'error');
        }
      } else {
        const newAssign: DataRecord = {
          id: Date.now().toString(),
          type: 'assignment',
          class_id: classId,
          subject_id: subjectId,
          teacher_id: teacherId,
          role: '',
          subject: '',
          username: currentUser.id,
        };
        const result = await createRecord(newAssign);
        setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
        if (result.isOk) {
          showMessage('💾 Gandingan jadual berjaya dipetakan', 'success');
        } else {
          showMessage('Ralat pemetaan tugasan baru', 'error');
        }
      }
    } else {
      // slot === 3 (Guru Ketiga -> subject)
      if (teacherId === '') {
        setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
        if (existing) {
          if (existing.teacher_id || existing.role) {
            const updated: DataRecord = { ...existing, subject: '' };
            await updateRecord(updated);
          } else {
            await deleteRecord(existing);
          }
        }
        return;
      }

      if (existing) {
        const updated: DataRecord = { ...existing, subject: teacherId };
        const result = await updateRecord(updated);
        if (result.isOk) {
          showMessage('💾 Guru ketiga berjaya dipetakan', 'success');
        } else {
          showMessage('Ralat mengemaskini guru ketiga', 'error');
        }
      } else {
        const newAssign: DataRecord = {
          id: Date.now().toString(),
          type: 'assignment',
          class_id: classId,
          subject_id: subjectId,
          teacher_id: teacherId,
          role: '',
          subject: '',
          username: currentUser.id,
        };
        const result = await createRecord(newAssign);
        setExpandedSecondTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
        setExpandedThirdTeacherCells((prev) => ({ ...prev, [cellKey]: false }));
        if (result.isOk) {
          showMessage('💾 Gandingan jadual berjaya dipetakan', 'success');
        } else {
          showMessage('Ralat pemetaan tugasan baru', 'error');
        }
      }
    }
  };

  const confirmClearAssignments = () => {
    if (!currentUser) return;
    openModal({
      title: 'Kosongkan Seluruh Pemetaan',
      message:
        'Adakah anda benar-benar pasti mahu memadam kesemua gandingan guru dan subjek bagi jadual pemetaan sekolah ini? Tindakan ini tidak boleh diundurkan!',
      icon: '⚠️',
      confirmText: 'Padam Semua',
      onConfirm: async () => {
        const schoolAssigns = allData.filter(
          (a) => a.type === 'assignment' && a.username === currentUser.id
        );
        for (const assign of schoolAssigns) {
          await deleteRecord(assign);
        }
        showMessage('Semua pemetaan telah berjaya dikosongkan', 'success');
      },
    });
  };

  const injectDemoData = () => {
    openModal({
      title: 'Masukkan Data Contoh?',
      message:
        'Tindakan ini akan memasukkan data demo yang lengkap (5 Guru, 4 Kelas, 5 Mata Pelajaran, dan Gandingan Jadual) supaya anda boleh menguji visual laporan serta-merta tanpa mengisi borang secara manual.',
      icon: '⚡',
      confirmText: 'Isi Data Contoh',
      onConfirm: async () => {
        const demoSchoolId = 'DEMO101';
        const demoSchool: DataRecord = {
          id: demoSchoolId,
          type: 'user',
          name: 'ABA1234',
          username: 'SK SERI PERMAI (DEMO)',
          role: '1234',
        };

        const cleanOld = allData.filter(
          (d) => d.username === demoSchoolId || d.id === demoSchoolId
        );
        for (const item of cleanOld) {
          await deleteRecord(item);
        }

        await createRecord(demoSchool);

        const teachers: DataRecord[] = [
          {
            id: 't1',
            type: 'teacher',
            name: 'CIKGU HALIM BIN OSMAN',
            subject: 'CG. HALIM',
            maxHours: 25,
            username: demoSchoolId,
          },
          {
            id: 't2',
            type: 'teacher',
            name: 'CIKGU NORAINI BINTI JAAFAR',
            subject: 'CG. RAINI',
            maxHours: 30,
            username: demoSchoolId,
          },
          {
            id: 't3',
            type: 'teacher',
            name: 'CIKGU SURESH A/L RAMAN',
            subject: 'CG. SURESH',
            maxHours: 28,
            username: demoSchoolId,
          },
          {
            id: 't4',
            type: 'teacher',
            name: 'USTAZAH AMINAH BINTI BAKAR',
            subject: 'USTZ. AMINAH',
            maxHours: 22,
            username: demoSchoolId,
          },
          {
            id: 't5',
            type: 'teacher',
            name: 'CIKGU TAN CHIN HOAT',
            subject: 'CG. TAN',
            maxHours: 28,
            username: demoSchoolId,
          },
        ];

        for (const t of teachers) {
          await createRecord(t);
        }

        const classes: DataRecord[] = [
          { id: 'c1', type: 'class', class_id: 'Tahun 1', name: '1 CERDIK', subject: '1C', level: 'Tahap 1', role: 't1', username: demoSchoolId },
          { id: 'c2', type: 'class', class_id: 'Tahun 3', name: '3 BESTARI', subject: '3B', level: 'Tahap 1', role: 't2', username: demoSchoolId },
          { id: 'c3', type: 'class', class_id: 'Tahun 4', name: '4 AMANAH', subject: '4A', level: 'Tahap 2', role: 't3', username: demoSchoolId },
          { id: 'c4', type: 'class', class_id: 'Tahun 6', name: '6 GEMILANG', subject: '6G', level: 'Tahap 2', role: 't5', username: demoSchoolId },
        ];

        for (const c of classes) {
          await createRecord(c);
        }

        const subjects: DataRecord[] = [
          { id: 's1', type: 'subject', name: 'BAHASA MELAYU', class_id: 'BM', role: '6', subject: '6', subject_id: '6', username: demoSchoolId },
          { id: 's2', type: 'subject', name: 'BAHASA INGGERIS', class_id: 'BI', role: '5', subject: '5', subject_id: '5', username: demoSchoolId },
          { id: 's3', type: 'subject', name: 'MATEMATIK', class_id: 'MT', role: '4', subject: '5', subject_id: '5', username: demoSchoolId },
          { id: 's4', type: 'subject', name: 'SAINS', class_id: 'SN', role: '3', subject: '4', subject_id: '4', username: demoSchoolId },
          { id: 's5', type: 'subject', name: 'PENDIDIKAN ISLAM', class_id: 'PI', role: '4', subject: '4', subject_id: '4', username: demoSchoolId },
        ];

        for (const s of subjects) {
          await createRecord(s);
        }

        const levels: DataRecord[] = [
          { id: 'l1', type: 'level', name: 'Tahap 1', role: 'Tahun 1', level: 'Tahap 1', username: demoSchoolId },
          { id: 'l2', type: 'level', name: 'Tahap 1', role: 'Tahun 2', level: 'Tahap 1', username: demoSchoolId },
          { id: 'l3', type: 'level', name: 'Tahap 1', role: 'Tahun 3', level: 'Tahap 1', username: demoSchoolId },
          { id: 'l4', type: 'level', name: 'Tahap 2', role: 'Tahun 4', level: 'Tahap 2', username: demoSchoolId },
          { id: 'l5', type: 'level', name: 'Tahap 2', role: 'Tahun 5', level: 'Tahap 2', username: demoSchoolId },
          { id: 'l6', type: 'level', name: 'Tahap 2', role: 'Tahun 6', level: 'Tahap 2', username: demoSchoolId },
        ];

        for (const l of levels) {
          await createRecord(l);
        }

        const assignments: DataRecord[] = [
          { id: 'a1', type: 'assignment', class_id: 'c1', subject_id: 's1', teacher_id: 't1', username: demoSchoolId },
          { id: 'a2', type: 'assignment', class_id: 'c1', subject_id: 's2', teacher_id: 't2', username: demoSchoolId },
          { id: 'a3', type: 'assignment', class_id: 'c2', subject_id: 's1', teacher_id: 't2', username: demoSchoolId },
          { id: 'a4', type: 'assignment', class_id: 'c3', subject_id: 's3', teacher_id: 't3', username: demoSchoolId },
          { id: 'a5', type: 'assignment', class_id: 'c3', subject_id: 's4', teacher_id: 't5', username: demoSchoolId },
          { id: 'a6', type: 'assignment', class_id: 'c4', subject_id: 's1', teacher_id: 't1', username: demoSchoolId },
          { id: 'a7', type: 'assignment', class_id: 'c4', subject_id: 's5', teacher_id: 't4', username: demoSchoolId },
        ];

        for (const a of assignments) {
          await createRecord(a);
        }

        setCurrentUser(demoSchool);
        showMessage('⚡ Demo data dimasukkan! Selamat menguji.', 'success');
        switchTab(6);
      },
    });
  };

  const fitReportToSingleA4Landscape = () => {
    const TARGET_W = 1082;
    const TARGET_H = 738;

    const pages = Array.from(
      document.querySelectorAll<HTMLDivElement>('.print-fit-page')
    );
    if (printContentRef.current && !pages.includes(printContentRef.current)) {
      pages.push(printContentRef.current);
    }
    if (pages.length === 0) return;

    const CANDIDATE_FONTS = [
      15.5, 15, 14.5, 14, 13.5, 13, 12.5, 12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8,
    ];

    let firstScale = 1;
    let firstPageFont = 10;
    pages.forEach((el, idx) => {
      el.style.transform = 'none';
      el.style.width = `${TARGET_W}px`;
      el.style.minHeight = `${TARGET_H}px`;

      const tableEl = el.querySelector<HTMLTableElement>('table.print-auto-table');
      if (tableEl) {
        if (idx === 0) {
          let bestFont = 9;
          let bestScale = 1;
          let bestEffective = -1;
          let foundNativeFit = false;

          for (const fontSize of CANDIDATE_FONTS) {
            tableEl.style.fontSize = `${fontSize}px`;
            const naturalW = Math.max(TARGET_W, el.scrollWidth);
            const naturalH = Math.max(TARGET_H, el.scrollHeight);
            const scale = Math.min(1, TARGET_W / naturalW, TARGET_H / naturalH);
            const effective = fontSize * scale;

            if (scale >= 0.999) {
              bestFont = fontSize;
              bestScale = scale;
              foundNativeFit = true;
              break;
            }

            if (
              effective > bestEffective + 0.05 ||
              (Math.abs(effective - bestEffective) <= 0.05 && scale > bestScale)
            ) {
              bestEffective = effective;
              bestFont = fontSize;
              bestScale = scale;
            }
          }

          if (!foundNativeFit) {
            tableEl.style.fontSize = `${bestFont}px`;
          }
          firstPageFont = bestFont;
        } else {
          // Page 2 and subsequent pages follow Page 1's font size
          tableEl.style.fontSize = `${firstPageFont}px`;
        }
      }

      const naturalW = Math.max(TARGET_W, el.scrollWidth);
      const naturalH = Math.max(TARGET_H, el.scrollHeight);
      const rawScale = Math.min(1, TARGET_W / naturalW, TARGET_H / naturalH);
      const scale = idx === 0 ? rawScale : Math.min(firstScale, rawScale);

      el.style.width = `${Math.floor(TARGET_W / scale)}px`;
      el.style.minHeight = `${Math.floor(TARGET_H / scale)}px`;
      el.style.transform = scale < 1 ? `scale(${scale})` : 'none';
      el.style.transformOrigin = 'top left';
      if (idx === 0) firstScale = scale;
    });

    setPrintScale(firstScale);
  };

  const printSchedule = async () => {
    if (!currentUser) {
      showMessage('Akses disekat. Sila log masuk dahulu.', 'error');
      return;
    }

    setIsGeneratingPdf(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pageW = 297;
      const marginX = 8;
      const contentW = pageW - marginX * 2; // 281mm

      const printDateStr = new Date().toLocaleDateString('ms-MY', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const classesForPdf = allData
        .filter((d) => d.type === 'class' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'));

      const subjectsForPdf = allData
        .filter((d) => d.type === 'subject' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'));

      const teachersForPdf = allData.filter(
        (d) => d.type === 'teacher' && d.username === currentUser.id
      );

      const assignmentsForPdf = allData.filter(
        (d) => d.type === 'assignment' && d.username === currentUser.id
      );

      const CLASSES_PER_PAGE = 15;
      const classPages: DataRecord[][] = [];
      for (let i = 0; i < classesForPdf.length; i += CLASSES_PER_PAGE) {
        classPages.push(classesForPdf.slice(i, i + CLASSES_PER_PAGE));
      }
      if (classPages.length === 0) {
        classPages.push([]);
      }

      const fitText = (text: string, maxW: number, fontSize: number): string => {
        pdf.setFontSize(fontSize);
        if (pdf.getTextWidth(text) <= maxW) return text;
        let trimmed = text;
        while (trimmed.length > 1 && pdf.getTextWidth(`${trimmed}..`) > maxW) {
          trimmed = trimmed.slice(0, -1);
        }
        return `${trimmed}..`;
      };

      const drawFittedText = (
        text: string,
        x: number,
        y: number,
        maxW: number,
        preferredSize: number,
        minSize: number,
        align: 'left' | 'center' | 'right' = 'center'
      ) => {
        let fs = preferredSize;
        pdf.setFontSize(fs);
        while (fs > minSize && pdf.getTextWidth(text) > maxW) {
          fs = +(fs - 0.3).toFixed(2);
          pdf.setFontSize(fs);
        }
        const fittedStr = fitText(text, maxW, fs);
        pdf.text(fittedStr, x, y, { align });
      };

      classPages.forEach((pageClasses, pageIndex) => {
        if (pageIndex > 0) {
          pdf.addPage('a4', 'landscape');
        }

        // 1. Letterhead Header
        pdf.setTextColor(15, 23, 42);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.text(
          String(currentUser.username || '-').toUpperCase(),
          pageW / 2,
          12.5,
          { align: 'center' }
        );

        pdf.setTextColor(79, 70, 229);
        pdf.setFontSize(9.5);
        pdf.text(
          'RUMUSAN PEMETAAN JADUAL WAKTU MENGIKUT KELAS',
          pageW / 2,
          17.5,
          { align: 'center' }
        );

        pdf.setTextColor(71, 85, 105);
        pdf.setFontSize(8);
        const dateHeaderText =
          classPages.length > 1
            ? `TARIKH CETAKAN: ${printDateStr.toUpperCase()}   •   MUKA SURAT ${pageIndex + 1} / ${classPages.length}`
            : `TARIKH CETAKAN: ${printDateStr.toUpperCase()}`;
        pdf.text(dateHeaderText, pageW / 2, 22, {
          align: 'center',
        });

        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.6);
        pdf.line(marginX, 24.8, pageW - marginX, 24.8);

        // 2. Main Schedule Table (Max 15 Classes per A4 Landscape Page)
        const isLastPage = pageIndex === classPages.length - 1;
        const tableTopY = 27.5;
        const maxTableBottomY = isLastPage ? 177.5 : 199;
        const availTableH = maxTableBottomY - tableTopY;

        if (pageClasses.length === 0 || subjectsForPdf.length === 0) {
          pdf.setTextColor(148, 163, 184);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.text(
            'Tiada data asas untuk pratinjau cetakan.',
            pageW / 2,
            95,
            { align: 'center' }
          );
        } else {
          const clsCount = pageClasses.length;
          const sizingRowCount = Math.max(clsCount, 1);
          const subjCount = subjectsForPdf.length;

          const bilColW = 10;
          const kelasColW = subjCount <= 16 ? 54 : 48;
          const subjColW = (contentW - bilColW - kelasColW) / subjCount;

          const headerH = Math.min(
            12,
            Math.max(7.2, availTableH / (sizingRowCount + 1.4))
          );
          const rowH = Math.min(
            18,
            (availTableH - headerH) / sizingRowCount
          );

          const headerHPt = headerH * 2.83465;
          const rowHPt = rowH * 2.83465;

          const headerFontSize = Math.min(
            11,
            Math.max(6, headerHPt * 0.54)
          );
          const bilFontSize = Math.min(12, Math.max(6.8, rowHPt * 0.45));
          const nameFontSize = Math.min(11.5, Math.max(6.5, rowHPt * 0.39));
          const cellFontSize = Math.min(
            11.5,
            Math.max(6.2, Math.min(rowHPt * 0.38, subjColW * 0.65))
          );
          const subFontSize = Math.min(9.2, Math.max(5.0, cellFontSize * 0.8));
          const nameSubFontSize = Math.min(
            9.2,
            Math.max(5.2, nameFontSize * 0.78)
          );
          const threeLineFontSize = Math.min(
            cellFontSize * 0.92,
            Math.max(5.0, rowHPt * 0.27)
          );
          const threeLineSubFontSize = Math.min(
            subFontSize,
            Math.max(4.4, rowHPt * 0.23)
          );

          // Draw Table Header
          let curX = marginX;
          const curY = tableTopY;

          pdf.setFillColor(241, 245, 249);
          pdf.setDrawColor(15, 23, 42);
          pdf.setLineWidth(0.25);

          // BIL. Header
          pdf.rect(curX, curY, bilColW, headerH, 'FD');
          pdf.setTextColor(15, 23, 42);
          pdf.setFont('helvetica', 'bold');
          drawFittedText(
            'BIL.',
            curX + bilColW / 2,
            curY + headerH / 2 + headerFontSize * 0.12,
            bilColW - 1.5,
            headerFontSize,
            5.5,
            'center'
          );
          curX += bilColW;

          // KELAS Header
          pdf.rect(curX, curY, kelasColW, headerH, 'FD');
          pdf.setFontSize(headerFontSize);
          pdf.text(
            'KELAS',
            curX + 2,
            curY + headerH / 2 + headerFontSize * 0.12,
            {
              align: 'left',
            }
          );
          curX += kelasColW;

          // Subject Headers
          subjectsForPdf.forEach((subject) => {
            pdf.setFillColor(241, 245, 249);
            pdf.rect(curX, curY, subjColW, headerH, 'FD');
            const label = String(subject.class_id || subject.name || '').toUpperCase();
            drawFittedText(
              label,
              curX + subjColW / 2,
              curY + headerH / 2 + headerFontSize * 0.12,
              subjColW - 1.4,
              headerFontSize,
              4.8,
              'center'
            );
            curX += subjColW;
          });

          // Draw Rows (up to 15 classes per page)
          pageClasses.forEach((cls, idx) => {
            const globalIdx = pageIndex * CLASSES_PER_PAGE + idx;
            const rY = tableTopY + headerH + idx * rowH;
            let rX = marginX;

            const classTeacherObj = cls.role
              ? teachersForPdf.find((t) => t.id === cls.role)
              : null;
            const classTeacherName = classTeacherObj?.name || 'Tiada Guru Kelas';

            const classTotalWaktu = subjectsForPdf.reduce((sum, subject) => {
              const assignment = assignmentsForPdf.find(
                (a) => a.class_id === cls.id && a.subject_id === subject.id
              );
              const t1 = assignment
                ? teachersForPdf.find((t) => t.id === assignment.teacher_id)
                : null;
              const t2 =
                assignment && assignment.role
                  ? teachersForPdf.find((t) => t.id === assignment.role)
                  : null;
              const t3 =
                assignment && assignment.subject
                  ? teachersForPdf.find((t) => t.id === assignment.subject)
                  : null;
              if (!t1 && !t2 && !t3) return sum;
              const timeVal = parseFloat(
                cls.level === 'Tahap 1'
                  ? subject.role || '0'
                  : cls.level === 'Tahap 3'
                  ? subject.subject_id || '0'
                  : subject.subject || '0'
              );
              return sum + (Number.isFinite(timeVal) ? timeVal : 0);
            }, 0);

            // BIL. cell
            pdf.setFillColor(248, 250, 252);
            pdf.rect(rX, rY, bilColW, rowH, 'FD');
            pdf.setTextColor(15, 23, 42);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(bilFontSize);
            pdf.text(
              String(globalIdx + 1),
              rX + bilColW / 2,
              rY + rowH / 2 + bilFontSize * 0.12,
              { align: 'center' }
            );
            rX += bilColW;

            // KELAS + Jumlah Waktu & Nama Guru Kelas cell
            pdf.setFillColor(248, 250, 252);
            pdf.rect(rX, rY, kelasColW, rowH, 'FD');
            pdf.setTextColor(15, 23, 42);
            pdf.setFont('helvetica', 'bold');
            drawFittedText(
              `${String(cls.name || '').toUpperCase()} | Jumlah Waktu : ${classTotalWaktu}w`,
              rX + 2,
              rY + rowH * 0.41,
              kelasColW - 3.5,
              nameFontSize,
              5.2,
              'left'
            );

            pdf.setTextColor(79, 70, 229);
            pdf.setFont('helvetica', 'bold');
            drawFittedText(
              String(classTeacherName).toUpperCase(),
              rX + 2,
              rY + rowH * 0.79,
              kelasColW - 3.5,
              nameSubFontSize,
              4.6,
              'left'
            );
            rX += kelasColW;

            // Subject cells
            subjectsForPdf.forEach((subject) => {
              pdf.setFillColor(255, 255, 255);
              pdf.rect(rX, rY, subjColW, rowH, 'FD');

              const assignment = assignmentsForPdf.find(
                (a) => a.class_id === cls.id && a.subject_id === subject.id
              );
              const t1 = assignment
                ? teachersForPdf.find((t) => t.id === assignment.teacher_id)
                : null;
              const t2 =
                assignment && assignment.role
                  ? teachersForPdf.find((t) => t.id === assignment.role)
                  : null;
              const t3 =
                assignment && assignment.subject
                  ? teachersForPdf.find((t) => t.id === assignment.subject)
                  : null;
              const activeTeachers = [t1, t2, t3].filter((t): t is DataRecord => Boolean(t));

              const time =
                cls.level === 'Tahap 1'
                  ? subject.role || '0'
                  : cls.level === 'Tahap 3'
                  ? subject.subject_id || '0'
                  : subject.subject || '0';

              const centerX = rX + subjColW / 2;

              if (activeTeachers.length >= 3) {
                const fourLineFontSize = Math.min(
                  threeLineFontSize * 0.88,
                  Math.max(4.0, rowHPt * 0.21)
                );
                const fourLineSubFontSize = Math.min(
                  threeLineSubFontSize * 0.9,
                  Math.max(3.6, rowHPt * 0.18)
                );
                pdf.setTextColor(15, 23, 42);
                pdf.setFont('helvetica', 'bold');
                drawFittedText(
                  String(activeTeachers[0].subject || activeTeachers[0].name || '').toUpperCase(),
                  centerX,
                  rY + rowH * 0.24,
                  subjColW - 1.2,
                  fourLineFontSize,
                  3.8,
                  'center'
                );
                drawFittedText(
                  `+ ${String(activeTeachers[1].subject || activeTeachers[1].name || '').toUpperCase()}`,
                  centerX,
                  rY + rowH * 0.46,
                  subjColW - 1.2,
                  fourLineFontSize,
                  3.8,
                  'center'
                );
                drawFittedText(
                  `+ ${String(activeTeachers[2].subject || activeTeachers[2].name || '').toUpperCase()}`,
                  centerX,
                  rY + rowH * 0.68,
                  subjColW - 1.2,
                  fourLineFontSize,
                  3.8,
                  'center'
                );

                pdf.setTextColor(100, 116, 139);
                pdf.setFont('helvetica', 'bold');
                drawFittedText(
                  `${time} Wkt`,
                  centerX,
                  rY + rowH * 0.9,
                  subjColW - 1.2,
                  fourLineSubFontSize,
                  3.5,
                  'center'
                );
              } else if (activeTeachers.length === 2) {
                pdf.setTextColor(15, 23, 42);
                pdf.setFont('helvetica', 'bold');
                drawFittedText(
                  String(activeTeachers[0].subject || activeTeachers[0].name || '').toUpperCase(),
                  centerX,
                  rY + rowH * 0.3,
                  subjColW - 1.2,
                  threeLineFontSize,
                  4.2,
                  'center'
                );
                drawFittedText(
                  `+ ${String(activeTeachers[1].subject || activeTeachers[1].name || '').toUpperCase()}`,
                  centerX,
                  rY + rowH * 0.58,
                  subjColW - 1.2,
                  threeLineFontSize,
                  4.2,
                  'center'
                );

                pdf.setTextColor(100, 116, 139);
                pdf.setFont('helvetica', 'bold');
                drawFittedText(
                  `${time} Wkt`,
                  centerX,
                  rY + rowH * 0.87,
                  subjColW - 1.2,
                  threeLineSubFontSize,
                  3.8,
                  'center'
                );
              } else if (activeTeachers.length === 1) {
                const activeT = activeTeachers[0];
                pdf.setTextColor(15, 23, 42);
                pdf.setFont('helvetica', 'bold');
                drawFittedText(
                  String(activeT.subject || activeT.name || '').toUpperCase(),
                  centerX,
                  rY + rowH * 0.43,
                  subjColW - 1.2,
                  cellFontSize,
                  4.5,
                  'center'
                );

                pdf.setTextColor(100, 116, 139);
                pdf.setFont('helvetica', 'bold');
                drawFittedText(
                  `${time} Wkt`,
                  centerX,
                  rY + rowH * 0.8,
                  subjColW - 1.2,
                  subFontSize,
                  4.0,
                  'center'
                );
              } else {
                pdf.setTextColor(203, 213, 225);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(cellFontSize);
                pdf.text('-', centerX, rY + rowH / 2 + cellFontSize * 0.12, {
                  align: 'center',
                });
              }

              rX += subjColW;
            });
          });

          // Outer table frame
          const totalTableH = headerH + clsCount * rowH;
          pdf.setDrawColor(15, 23, 42);
          pdf.setLineWidth(0.45);
          pdf.rect(marginX, tableTopY, contentW, totalTableH, 'S');
        }

        // 3. Signature Block (Only on the last page, at the bottom of the page)
        if (isLastPage) {
          const sigTopY = 180;
          pdf.setDrawColor(226, 232, 240);
          pdf.setLineWidth(0.25);
          pdf.line(marginX, sigTopY, pageW - marginX, sigTopY);

          const leftSigX = pageW * 0.27;
          const rightSigX = pageW * 0.73;

          pdf.setTextColor(100, 116, 139);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.text('DISEDIAKAN OLEH,', leftSigX, sigTopY + 5, { align: 'center' });
          pdf.text('DISAHKAN OLEH,', rightSigX, sigTopY + 5, { align: 'center' });

          pdf.setDrawColor(148, 163, 184);
          pdf.setLineWidth(0.3);
          pdf.line(leftSigX - 24, sigTopY + 16, leftSigX + 24, sigTopY + 16);
          pdf.line(rightSigX - 24, sigTopY + 16, rightSigX + 24, sigTopY + 16);

          pdf.setTextColor(51, 65, 85);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.text('PENOLONG KANAN PENTADBIRAN', leftSigX, sigTopY + 20.5, {
            align: 'center',
          });
          pdf.text('GURU BESAR / PENGETUA', rightSigX, sigTopY + 20.5, {
            align: 'center',
          });
        }
      });

      const safeFileName = String(currentUser.name || 'Sekolah').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      pdf.save(
        currentTab === 11
          ? `Pemetaan_Guru_${safeFileName}.pdf`
          : `Pemetaan_Kelas_${safeFileName}.pdf`
      );

      setIsGeneratingPdf(false);
      showMessage('💾 PDF A4 Landskap (1 Muka Surat) berjaya dijana!', 'success');
    } catch (error) {
      setIsGeneratingPdf(false);
      showMessage('Ralat penjanaan dokumen cetakan', 'error');
      console.error(error);
    }
  };

  const printTeacherSchedule = async () => {
    if (!currentUser) {
      showMessage('Akses disekat. Sila log masuk dahulu.', 'error');
      return;
    }

    setIsGeneratingPdf(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pageW = 297;
      const marginX = 8;
      const contentW = pageW - marginX * 2; // 281mm

      const printDateStr = new Date().toLocaleDateString('ms-MY', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const teachersForPdf = allData
        .filter((d) => d.type === 'teacher' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'));

      const classesForPdf = allData
        .filter((d) => d.type === 'class' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'));

      const subjectsForPdf = allData
        .filter((d) => d.type === 'subject' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'));

      const assignmentsForPdf = allData.filter(
        (d) => d.type === 'assignment' && d.username === currentUser.id
      );

      const TEACHERS_PER_PAGE = 20;
      const teacherPages: DataRecord[][] = [];
      for (let i = 0; i < teachersForPdf.length; i += TEACHERS_PER_PAGE) {
        teacherPages.push(teachersForPdf.slice(i, i + TEACHERS_PER_PAGE));
      }
      if (teacherPages.length === 0) {
        teacherPages.push([]);
      }

      const fitText = (text: string, maxW: number, fontSize: number): string => {
        pdf.setFontSize(fontSize);
        if (pdf.getTextWidth(text) <= maxW) return text;
        let trimmed = text;
        while (trimmed.length > 1 && pdf.getTextWidth(`${trimmed}..`) > maxW) {
          trimmed = trimmed.slice(0, -1);
        }
        return `${trimmed}..`;
      };

      const drawFittedText = (
        text: string,
        x: number,
        y: number,
        maxW: number,
        preferredSize: number,
        minSize: number,
        align: 'left' | 'center' | 'right' = 'center'
      ) => {
        let fs = preferredSize;
        pdf.setFontSize(fs);
        while (fs > minSize && pdf.getTextWidth(text) > maxW) {
          fs = +(fs - 0.3).toFixed(2);
          pdf.setFontSize(fs);
        }
        const fittedStr = fitText(text, maxW, fs);
        pdf.text(fittedStr, x, y, { align });
      };

      teacherPages.forEach((pageTeachers, pageIndex) => {
        if (pageIndex > 0) {
          pdf.addPage('a4', 'landscape');
        }

        // 1. Letterhead Header
        pdf.setTextColor(15, 23, 42);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.text(
          String(currentUser.username || '-').toUpperCase(),
          pageW / 2,
          12.5,
          { align: 'center' }
        );

        pdf.setTextColor(79, 70, 229);
        pdf.setFontSize(9.5);
        pdf.text(
          'RUMUSAN PEMETAAN JADUAL WAKTU MENGIKUT GURU',
          pageW / 2,
          17.5,
          { align: 'center' }
        );

        pdf.setTextColor(71, 85, 105);
        pdf.setFontSize(8);
        const dateHeaderText =
          teacherPages.length > 1
            ? `TARIKH CETAKAN: ${printDateStr.toUpperCase()}   •   MUKA SURAT ${pageIndex + 1} / ${teacherPages.length}`
            : `TARIKH CETAKAN: ${printDateStr.toUpperCase()}`;
        pdf.text(dateHeaderText, pageW / 2, 22, {
          align: 'center',
        });

        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.6);
        pdf.line(marginX, 24.8, pageW - marginX, 24.8);

        // 2. Main Teacher Schedule Table (Max 20 Teachers per A4 Landscape Page)
        const isLastPage = pageIndex === teacherPages.length - 1;
        const tableTopY = 27.5;
        const maxTableBottomY = isLastPage ? 177.5 : 199;
        const availTableH = maxTableBottomY - tableTopY;

        if (pageTeachers.length === 0 || subjectsForPdf.length === 0) {
          pdf.setTextColor(148, 163, 184);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(10);
          pdf.text('Tiada data asas untuk pratinjau cetakan.', pageW / 2, 95, {
            align: 'center',
          });
        } else {
          const tCount = pageTeachers.length;
          // Use Page 1's teacher count and table height so Page 2+ follows Page 1's exact font sizes
          const firstPageRowCount = Math.max(teacherPages[0]?.length || 1, 1);
          const firstPageMaxBottomY = teacherPages.length > 1 ? 199 : 177.5;
          const firstPageAvailH = firstPageMaxBottomY - tableTopY;
          const subjCount = subjectsForPdf.length;

          const bilColW = 10;
          const guruColW = subjCount <= 16 ? 54 : 48;
          const subjColW = (contentW - bilColW - guruColW) / subjCount;

          const headerH = Math.min(
            12,
            Math.max(7.0, firstPageAvailH / (firstPageRowCount + 1.4))
          );
          const baseRowH = Math.min(
            18,
            (firstPageAvailH - headerH) / firstPageRowCount
          );
          const rowH = Math.min(
            baseRowH,
            (availTableH - headerH) / Math.max(tCount, 1)
          );

          const headerHPt = headerH * 2.83465;
          const baseRowHPt = baseRowH * 2.83465;

          const headerFontSize = Math.min(
            11,
            Math.max(6, headerHPt * 0.54)
          );
          const bilFontSize = Math.min(12, Math.max(6.8, baseRowHPt * 0.45));
          const nameFontSize = Math.min(11.2, Math.max(6.4, baseRowHPt * 0.37));
          const guruFontSize = +(nameFontSize * 1.1).toFixed(2);
          const nameSubFontSize = Math.min(
            9.0,
            Math.max(5.0, nameFontSize * 0.78)
          );
          const cellFontSize = Math.min(
            11.5,
            Math.max(6.0, Math.min(baseRowHPt * 0.38, subjColW * 0.65))
          );
          const subFontSize = Math.min(9.0, Math.max(4.8, cellFontSize * 0.78));
          const twoLineFontSize = Math.min(
            cellFontSize * 0.9,
            Math.max(4.8, baseRowHPt * 0.27)
          );
          const twoLineSubFontSize = Math.min(
            subFontSize,
            Math.max(4.3, baseRowHPt * 0.23)
          );

          // Draw Table Header
          let curX = marginX;
          const curY = tableTopY;

          pdf.setFillColor(241, 245, 249);
          pdf.setDrawColor(15, 23, 42);
          pdf.setLineWidth(0.25);

          pdf.rect(curX, curY, bilColW, headerH, 'FD');
          pdf.setTextColor(15, 23, 42);
          pdf.setFont('helvetica', 'bold');
          drawFittedText(
            'BIL.',
            curX + bilColW / 2,
            curY + headerH / 2 + headerFontSize * 0.12,
            bilColW - 1.5,
            headerFontSize,
            5.5,
            'center'
          );
          curX += bilColW;

          pdf.rect(curX, curY, guruColW, headerH, 'FD');
          pdf.setFontSize(headerFontSize);
          pdf.text(
            'NAMA GURU',
            curX + 2,
            curY + headerH / 2 + headerFontSize * 0.12,
            {
              align: 'left',
            }
          );
          curX += guruColW;

          subjectsForPdf.forEach((subject) => {
            pdf.setFillColor(241, 245, 249);
            pdf.rect(curX, curY, subjColW, headerH, 'FD');
            const label = String(subject.class_id || subject.name || '').toUpperCase();
            drawFittedText(
              label,
              curX + subjColW / 2,
              curY + headerH / 2 + headerFontSize * 0.12,
              subjColW - 1.4,
              headerFontSize,
              4.8,
              'center'
            );
            curX += subjColW;
          });

          // Draw Teacher Rows (up to 22 per page)
          pageTeachers.forEach((teacher, idx) => {
            const globalIdx = pageIndex * TEACHERS_PER_PAGE + idx;
            const rY = tableTopY + headerH + idx * rowH;
            let rX = marginX;

            const teacherTotalWaktu = assignmentsForPdf
              .filter(
                (a) =>
                  a.teacher_id === teacher.id ||
                  a.role === teacher.id ||
                  a.subject === teacher.id
              )
              .reduce((sum, a) => {
                const cls = classesForPdf.find((c) => c.id === a.class_id);
                const subj = subjectsForPdf.find((s) => s.id === a.subject_id);
                if (!cls || !subj) return sum;
                const t =
                  cls.level === 'Tahap 1'
                    ? parseFloat(subj.role || '0')
                    : cls.level === 'Tahap 3'
                    ? parseFloat(subj.subject_id || '0')
                    : parseFloat(subj.subject || '0');
                return sum + (Number.isFinite(t) ? t : 0);
              }, 0);

            // BIL. cell
            pdf.setFillColor(248, 250, 252);
            pdf.rect(rX, rY, bilColW, rowH, 'FD');
            pdf.setTextColor(15, 23, 42);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(bilFontSize);
            pdf.text(
              String(globalIdx + 1),
              rX + bilColW / 2,
              rY + rowH / 2 + bilFontSize * 0.12,
              { align: 'center' }
            );
            rX += bilColW;

            // NAMA GURU + Jumlah Waktu cell
            pdf.setFillColor(248, 250, 252);
            pdf.rect(rX, rY, guruColW, rowH, 'FD');
            pdf.setTextColor(15, 23, 42);
            pdf.setFont('helvetica', 'bold');
            drawFittedText(
              String(teacher.name || '').toUpperCase(),
              rX + 2,
              rY + rowH * 0.42,
              guruColW - 3.5,
              guruFontSize,
              5.4,
              'left'
            );

            pdf.setTextColor(79, 70, 229);
            pdf.setFont('helvetica', 'bold');
            drawFittedText(
              `Jumlah Waktu : ${teacherTotalWaktu}w`,
              rX + 2,
              rY + rowH * 0.8,
              guruColW - 3.5,
              nameSubFontSize,
              4.6,
              'left'
            );
            rX += guruColW;

            // Subject cells for this teacher
            subjectsForPdf.forEach((subject) => {
              pdf.setFillColor(255, 255, 255);
              pdf.rect(rX, rY, subjColW, rowH, 'FD');

              const matchedAssignments = assignmentsForPdf.filter(
                (a) =>
                  a.subject_id === subject.id &&
                  (a.teacher_id === teacher.id ||
                    a.role === teacher.id ||
                    a.subject === teacher.id)
              );

              const matchedClasses = matchedAssignments
                .map((a) => classesForPdf.find((c) => c.id === a.class_id))
                .filter((c): c is DataRecord => Boolean(c));

              const totalTime = matchedClasses.reduce((sum, cls) => {
                const t =
                  cls.level === 'Tahap 1'
                    ? parseFloat(subject.role || '0')
                    : cls.level === 'Tahap 3'
                    ? parseFloat(subject.subject_id || '0')
                    : parseFloat(subject.subject || '0');
                return sum + (Number.isFinite(t) ? t : 0);
              }, 0);

              const centerX = rX + subjColW / 2;

              if (matchedClasses.length > 0) {
                const classLabels = matchedClasses.map((c) =>
                  String(c.subject || c.name || '').toUpperCase()
                );

                if (classLabels.length > 2) {
                  const mid = Math.ceil(classLabels.length / 2);
                  const topRowStr = classLabels.slice(0, mid).join(', ');
                  const bottomRowStr = classLabels.slice(mid).join(', ');

                  pdf.setTextColor(15, 23, 42);
                  pdf.setFont('helvetica', 'bold');
                  drawFittedText(
                    topRowStr,
                    centerX,
                    rY + rowH * 0.3,
                    subjColW - 1.2,
                    twoLineFontSize,
                    4.0,
                    'center'
                  );
                  drawFittedText(
                    bottomRowStr,
                    centerX,
                    rY + rowH * 0.58,
                    subjColW - 1.2,
                    twoLineFontSize,
                    4.0,
                    'center'
                  );

                  pdf.setTextColor(100, 116, 139);
                  pdf.setFont('helvetica', 'bold');
                  drawFittedText(
                    `${totalTime} Wkt`,
                    centerX,
                    rY + rowH * 0.87,
                    subjColW - 1.2,
                    twoLineSubFontSize,
                    3.7,
                    'center'
                  );
                } else {
                  const classNamesStr = classLabels.join(', ');
                  pdf.setTextColor(15, 23, 42);
                  pdf.setFont('helvetica', 'bold');
                  drawFittedText(
                    classNamesStr,
                    centerX,
                    rY + rowH * 0.43,
                    subjColW - 1.2,
                    cellFontSize,
                    4.3,
                    'center'
                  );

                  pdf.setTextColor(100, 116, 139);
                  pdf.setFont('helvetica', 'bold');
                  drawFittedText(
                    `${totalTime} Wkt`,
                    centerX,
                    rY + rowH * 0.8,
                    subjColW - 1.2,
                    subFontSize,
                    3.9,
                    'center'
                  );
                }
              } else {
                pdf.setTextColor(203, 213, 225);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(cellFontSize);
                pdf.text('-', centerX, rY + rowH / 2 + cellFontSize * 0.12, {
                  align: 'center',
                });
              }

              rX += subjColW;
            });
          });

          const totalTableH = headerH + tCount * rowH;
          pdf.setDrawColor(15, 23, 42);
          pdf.setLineWidth(0.45);
          pdf.rect(marginX, tableTopY, contentW, totalTableH, 'S');
        }

        // 3. Signature Block (Only on the last page, at the bottom of the page)
        if (isLastPage) {
          const sigTopY = 180;
          pdf.setDrawColor(226, 232, 240);
          pdf.setLineWidth(0.25);
          pdf.line(marginX, sigTopY, pageW - marginX, sigTopY);

          const leftSigX = pageW * 0.27;
          const rightSigX = pageW * 0.73;

          pdf.setTextColor(100, 116, 139);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.text('DISEDIAKAN OLEH,', leftSigX, sigTopY + 5, { align: 'center' });
          pdf.text('DISAHKAN OLEH,', rightSigX, sigTopY + 5, { align: 'center' });

          pdf.setDrawColor(148, 163, 184);
          pdf.setLineWidth(0.3);
          pdf.line(leftSigX - 24, sigTopY + 16, leftSigX + 24, sigTopY + 16);
          pdf.line(rightSigX - 24, sigTopY + 16, rightSigX + 24, sigTopY + 16);

          pdf.setTextColor(51, 65, 85);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.text('PENOLONG KANAN PENTADBIRAN', leftSigX, sigTopY + 20.5, {
            align: 'center',
          });
          pdf.text('GURU BESAR / PENGETUA', rightSigX, sigTopY + 20.5, {
            align: 'center',
          });
        }
      });

      const safeFileName = String(currentUser.name || 'Sekolah').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      pdf.save(`Pemetaan_Guru_${safeFileName}.pdf`);

      setIsGeneratingPdf(false);
      showMessage('💾 PDF Pemetaan Guru A4 Landskap berjaya dijana!', 'success');
    } catch (error) {
      setIsGeneratingPdf(false);
      showMessage('Ralat penjanaan dokumen cetakan', 'error');
      console.error(error);
    }
  };

  // Derived data collections
  const usersList = allData.filter((d) => d.type === 'user');

  const schoolTeachers = currentUser
    ? allData
        .filter((d) => d.type === 'teacher' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'))
    : [];

  const filteredTeachers = teacherSearch.trim()
    ? schoolTeachers.filter((d) =>
        (d.name || '').toLowerCase().includes(teacherSearch.toLowerCase())
      )
    : schoolTeachers;

  const schoolClasses = currentUser
    ? allData
        .filter((d) => d.type === 'class' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'))
    : [];

  const schoolSubjects = currentUser
    ? allData
        .filter((d) => d.type === 'subject' && d.username === currentUser.id)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'))
    : [];

  const schoolAssignments = currentUser
    ? allData.filter((d) => d.type === 'assignment' && d.username === currentUser.id)
    : [];

  const schoolLevels = currentUser
    ? allData
        .filter((d) => d.type === 'level' && d.username === currentUser.id)
        .sort((a, b) => {
          const cmpTahap = (a.name || '').localeCompare(b.name || '', 'ms');
          if (cmpTahap !== 0) return cmpTahap;
          return (a.role || '').localeCompare(b.role || '', 'ms');
        })
    : [];

  const exportSchoolDataJson = () => {
    if (!currentUser) {
      showMessage('Akses disekat. Sila log masuk dahulu.', 'error');
      return;
    }

    try {
      const teacherMap = new Map(schoolTeachers.map((t) => [t.id, t]));
      const classMap = new Map(schoolClasses.map((c) => [c.id, c]));
      const subjectMap = new Map(schoolSubjects.map((s) => [s.id, s]));

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        appVersion: '2.0',
        school: {
          id: currentUser.id,
          code: currentUser.name || '',
          name: currentUser.username || '',
        },
        summary: {
          totalTeachers: schoolTeachers.length,
          totalLevels: schoolLevels.length,
          totalClasses: schoolClasses.length,
          totalSubjects: schoolSubjects.length,
          totalAssignments: schoolAssignments.length,
        },
        teachers: schoolTeachers.map((t) => ({
          id: t.id,
          name: t.name || '',
          shortName: t.subject || '',
          maxHours: t.maxHours ?? 30,
        })),
        levels: schoolLevels.map((l) => ({
          id: l.id,
          tahap: l.name || l.level || '',
          tahun: l.role || '',
        })),
        classes: schoolClasses.map((c) => {
          const classTeacher = c.role ? teacherMap.get(c.role) : undefined;
          return {
            id: c.id,
            name: c.name || '',
            shortName: c.subject || '',
            tahun: c.class_id || '',
            level: c.level || '',
            classTeacherId: c.role || '',
            classTeacherName: classTeacher ? classTeacher.name || '' : '',
          };
        }),
        subjects: schoolSubjects.map((s) => ({
          id: s.id,
          name: s.name || '',
          shortName: s.class_id || '',
          periodsTahap1: Number(s.role || 0),
          periodsTahap2: Number(s.subject || 0),
          periodsTahap3: Number(s.subject_id || 0),
        })),
        assignments: schoolAssignments.map((a) => {
          const cls = a.class_id ? classMap.get(a.class_id) : undefined;
          const subj = a.subject_id ? subjectMap.get(a.subject_id) : undefined;
          const teacherIds = [a.teacher_id, a.role, a.subject].filter(
            (id): id is string => Boolean(id)
          );
          const teachers = teacherIds.map((id) => {
            const t = teacherMap.get(id);
            return {
              id,
              name: t?.name || '',
              shortName: t?.subject || '',
            };
          });
          return {
            id: a.id,
            classId: a.class_id || '',
            className: cls?.name || '',
            classLevel: cls?.level || '',
            subjectId: a.subject_id || '',
            subjectName: subj?.name || '',
            subjectShortName: subj?.class_id || '',
            teacherIds,
            teachers,
          };
        }),
        rawRecords: {
          teachers: schoolTeachers,
          levels: schoolLevels,
          classes: schoolClasses,
          subjects: schoolSubjects,
          assignments: schoolAssignments,
        },
      };

      const rawSchoolCode = String(currentUser.name || 'Sekolah').trim();
      const safeSchoolCode = rawSchoolCode.replace(/[\\/:*?"<>|]/g, '_') || 'Sekolah';
      const fileName = `${safeSchoolCode} - Data Pemetaan.json`;

      const jsonString = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      showMessage(`💾 Fail ${fileName} berjaya dimuat turun!`, 'success');
    } catch (error) {
      console.error('JSON export failed:', error);
      showMessage('Ralat semasa mengeksport data JSON', 'error');
    }
  };

  useEffect(() => {
    if (currentTab === 9 || currentTab === 11) {
      const raf = requestAnimationFrame(() => {
        fitReportToSingleA4Landscape();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [
    currentTab,
    allData,
    currentUser,
  ]);

  const getIcon = (type: 'users' | 'teachers' | 'classes' | 'subjects' | 'levels') => {
    const icons = {
      users: '🏫',
      teachers: '👨‍🏫',
      classes: '🎒',
      subjects: '📚',
      levels: '🏷️',
    };
    return icons[type] || '📌';
  };

  const renderCardList = (
    type: 'users' | 'teachers' | 'classes' | 'subjects' | 'levels',
    items: DataRecord[]
  ) => {
    if (!currentUser && type !== 'users') {
      return (
        <div className="col-span-full text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
          <span className="text-4xl block mb-2">🔒</span>
          <p className="text-sm font-semibold">Sila log masuk untuk melihat rekod maklumat.</p>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="col-span-full text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
          <span className="text-3xl block mb-2">📂</span>
          <p className="text-sm font-semibold">Tiada sebarang data disimpan setakat ini.</p>
          <p className="text-xs mt-1">Sila tambah rekod baru menggunakan butang di atas.</p>
        </div>
      );
    }

    return items.map((item, index) => {
      let teacherName = 'Tiada Guru Kelas';
      if (type === 'classes' && item.role) {
        const teacher = allData.find((t) => t.id === item.role);
        if (teacher && teacher.name) teacherName = teacher.name;
      }

      const levelBadgeColor =
        item.level === 'Tahap 1'
          ? 'bg-blue-100 text-blue-800'
          : item.level === 'Tahap 3'
          ? 'bg-purple-100 text-purple-800'
          : 'bg-emerald-100 text-emerald-800';

      return (
        <div
          key={item.id}
          className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-xs hover:shadow-md hover:border-indigo-100 transition-all duration-200 flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xxs flex items-center justify-center">
                #{index + 1}
              </span>
              <span className="text-lg">{getIcon(type)}</span>
            </div>

            <div>
              {type === 'users' ? (
                (() => {
                  const schoolTeacherIds = new Set(
                    allData
                      .filter((d) => d.type === 'teacher' && d.username === item.id)
                      .map((t) => t.id)
                  );
                  const schoolClassIds = new Set(
                    allData
                      .filter((d) => d.type === 'class' && d.username === item.id)
                      .map((c) => c.id)
                  );
                  const schoolSubjectIds = new Set(
                    allData
                      .filter((d) => d.type === 'subject' && d.username === item.id)
                      .map((s) => s.id)
                  );
                  const filledSlotCount = new Set(
                    allData
                      .filter(
                        (d) =>
                          d.type === 'assignment' &&
                          d.username === item.id &&
                          d.class_id &&
                          d.subject_id &&
                          schoolClassIds.has(d.class_id) &&
                          schoolSubjectIds.has(d.subject_id) &&
                          ((d.teacher_id && schoolTeacherIds.has(d.teacher_id)) ||
                            (d.role && schoolTeacherIds.has(d.role)) ||
                            (d.subject && schoolTeacherIds.has(d.subject)))
                      )
                      .map((d) => `${d.class_id}_${d.subject_id}`)
                  ).size;

                  return (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-extrabold text-slate-800 tracking-tight text-sm uppercase leading-tight truncate">
                          {item.name}
                        </p>
                        <p className="text-xs font-semibold text-indigo-600 mt-1 uppercase truncate">
                          {item.username}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">🔑 ••••••••</p>
                      </div>
                      <div className="shrink-0 bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5 space-y-1 text-left">
                        <p className="text-xs font-bold text-slate-700 whitespace-nowrap">
                          Bil Guru :{' '}
                          <span className="text-indigo-600">{schoolTeacherIds.size}</span>
                        </p>
                        <p className="text-xs font-bold text-slate-700 whitespace-nowrap">
                          Bil Kelas :{' '}
                          <span className="text-indigo-600">{schoolClassIds.size}</span>
                        </p>
                        <p className="text-xs font-bold text-slate-700 whitespace-nowrap">
                          Bil Slot :{' '}
                          <span className="text-indigo-600">{filledSlotCount}</span>
                        </p>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <p className="font-extrabold text-slate-800 tracking-tight text-sm uppercase leading-tight truncate">
                  {item.name}
                </p>
              )}

              {type === 'teachers' && (
                <>
                  <p className="text-xs font-semibold text-indigo-600 mt-1">
                    Kod Singkatan: {item.subject || '-'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    ⚡ Had Waktu: <strong className="text-slate-700">{item.maxHours || 30} waktu</strong>
                  </p>
                </>
              )}

              {type === 'classes' && (
                <>
                  {item.subject && (
                    <p className="text-xs font-semibold text-slate-500 mt-1">
                      Nama Kelas (Short): <strong className="text-slate-700">{item.subject}</strong>
                    </p>
                  )}
                  <p className="text-xs font-bold text-indigo-600 mt-1 uppercase truncate">
                    👩‍🏫 Guru: {teacherName}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {item.class_id && (
                      <span className="inline-block px-2.5 py-0.5 text-[10px] font-bold bg-indigo-50 text-indigo-700 rounded-full">
                        {item.class_id}
                      </span>
                    )}
                    <span
                      className={`inline-block px-2.5 py-0.5 text-[10px] font-bold ${levelBadgeColor} rounded-full`}
                    >
                      {item.level || 'Tahap 1'}
                    </span>
                  </div>
                </>
              )}

              {type === 'subjects' && (
                <div className="mt-2 space-y-1">
                  {item.class_id && (
                    <p className="text-xs font-semibold text-indigo-600">
                      Short (Subjek): {item.class_id}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    ⏰ Masa Tahap 1: <strong className="text-slate-700">{item.role || '0'} waktu</strong>
                  </p>
                  <p className="text-xs text-slate-500">
                    ⏰ Masa Tahap 2: <strong className="text-slate-700">{item.subject || '0'} waktu</strong>
                  </p>
                  <p className="text-xs text-slate-500">
                    ⏰ Masa Tahap 3: <strong className="text-slate-700">{item.subject_id || '0'} waktu</strong>
                  </p>
                </div>
              )}

              {type === 'levels' && (
                <>
                  <p className="text-xs font-bold text-indigo-600 mt-1 uppercase truncate">
                    📅 Tahun: {item.role || 'Tahun 1'}
                  </p>
                  <span
                    className={`inline-block px-2.5 py-0.5 text-[10px] font-bold ${levelBadgeColor} rounded-full mt-2`}
                  >
                    {item.level || item.name || 'Tahap 1'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 mt-4 pt-3 border-t border-slate-100">
            <button
              onClick={() => editItem(type, item.id)}
              className="flex-1 py-1.5 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-100 text-slate-600 hover:text-indigo-700 rounded-lg text-xs font-bold transition-all"
            >
              ✏️ Edit
            </button>
            <button
              onClick={() =>
                confirmDeleteItem(
                  item.id,
                  type === 'levels' ? `${item.name} - ${item.role}` : item.name || ''
                )
              }
              className="py-1.5 px-3 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-100 text-slate-400 hover:text-rose-600 rounded-lg text-xs font-bold transition-all"
            >
              🗑️ Padam
            </button>
          </div>
        </div>
      );
    });
  };

  // Teacher Report Computation
  const teacherReportData = schoolTeachers.map((teacher) => {
    const teacherAssignments = schoolAssignments.filter(
      (a) =>
        a.teacher_id === teacher.id ||
        a.role === teacher.id ||
        a.subject === teacher.id
    );
    const subjectMap: Record<
      string,
      {
        subjectName: string;
        timeT1: string;
        timeT2: string;
        timeT3: string;
        classesT1: string[];
        classesT2: string[];
        classesT3: string[];
      }
    > = {};

    teacherAssignments.forEach((assignment) => {
      const subject = schoolSubjects.find((s) => s.id === assignment.subject_id);
      const cls = schoolClasses.find((c) => c.id === assignment.class_id);
      if (!subject || !cls) return;

      if (!subjectMap[subject.id]) {
        subjectMap[subject.id] = {
          subjectName: subject.name || '',
          timeT1: subject.role || '0',
          timeT2: subject.subject || '0',
          timeT3: subject.subject_id || '0',
          classesT1: [],
          classesT2: [],
          classesT3: [],
        };
      }

      if (cls.level === 'Tahap 1') {
        subjectMap[subject.id].classesT1.push(cls.name || '');
      } else if (cls.level === 'Tahap 3') {
        subjectMap[subject.id].classesT3.push(cls.name || '');
      } else {
        subjectMap[subject.id].classesT2.push(cls.name || '');
      }
    });

    let totalHours = 0;
    Object.values(subjectMap).forEach((subj) => {
      const t1Count = subj.classesT1.length;
      const t2Count = subj.classesT2.length;
      const t3Count = subj.classesT3.length;
      const t1Time = parseFloat(subj.timeT1) || 0;
      const t2Time = parseFloat(subj.timeT2) || 0;
      const t3Time = parseFloat(subj.timeT3) || 0;
      totalHours += t1Count * t1Time + t2Count * t2Time + t3Count * t3Time;
    });

    return { teacher, subjects: Object.values(subjectMap), totalHours };
  });

  // Class Report Computation
  const classReportData = schoolClasses.map((cls) => {
    const classTeacher = schoolTeachers.find((t) => t.id === cls.role);
    const classAssignments = schoolAssignments.filter((a) => a.class_id === cls.id);

    const subjectTeacherList = classAssignments
      .map((assignment) => {
        const subject = schoolSubjects.find((s) => s.id === assignment.subject_id);
        const teacher1 = schoolTeachers.find((t) => t.id === assignment.teacher_id);
        const teacher2 = assignment.role
          ? schoolTeachers.find((t) => t.id === assignment.role)
          : null;
        const teacher3 = assignment.subject
          ? schoolTeachers.find((t) => t.id === assignment.subject)
          : null;
        if (!subject || (!teacher1 && !teacher2 && !teacher3)) return null;

        const teacherNames = [
          teacher1 ? teacher1.subject || teacher1.name || '' : '',
          teacher2 ? teacher2.subject || teacher2.name || '' : '',
          teacher3 ? teacher3.subject || teacher3.name || '' : '',
        ]
          .filter(Boolean)
          .join(' + ');

        const time =
          cls.level === 'Tahap 1'
            ? subject.role || '0'
            : cls.level === 'Tahap 3'
            ? subject.subject_id || '0'
            : subject.subject || '0';
        return {
          subjectName: subject.name || '',
          teacherName: teacherNames,
          time: parseFloat(time) || 0,
        };
      })
      .filter((item): item is { subjectName: string; teacherName: string; time: number } => item !== null);

    const totalHours = subjectTeacherList.reduce((sum, item) => sum + item.time, 0);
    return {
      class: cls,
      classTeacher: classTeacher ? classTeacher.name : 'Tiada',
      subjectTeachers: subjectTeacherList,
      totalHours,
    };
  });

  const formattedPrintDate = new Date().toLocaleDateString('ms-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      {/* Main Container */}
      <div id="app" className="flex flex-col md:flex-row min-h-screen w-full transition-all duration-300">
        {/* SIDEBAR / NAVIGASI KIRI (Desktop Only) */}
        <aside className="hidden md:flex flex-col w-72 bg-white border-r border-slate-200 shrink-0 shadow-sm">
          {/* Logo / Header */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-md shadow-indigo-200">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  ></path>
                </svg>
              </div>
              <div>
                <h1 id="app-title" className="text-lg font-bold text-slate-900 tracking-tight leading-tight">
                  Pemetaan Jadual
                </h1>
                <p id="welcome-message" className="text-xs text-slate-500 mt-0.5">
                  Sistem Pengurusan Pintar
                </p>
              </div>
            </div>
          </div>

          {/* Profil Sekolah Aktif */}
          <div
            id="school-profile-badge"
            className={`px-6 py-4 bg-slate-50 border-b border-slate-100 ${currentUser ? '' : 'hidden'}`}
          >
            <div className="flex items-center space-x-3">
              <div
                className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs uppercase"
                id="school-initials"
              >
                {currentUser?.name ? currentUser.name.substring(0, 2) : 'SC'}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider truncate">
                  {currentUser?.username || 'Sekolah Aktif'}
                </p>
                <p className="text-sm font-bold text-slate-800 truncate" id="school-name-badge">
                  {currentUser?.name || '-'}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Links Group */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-7 custom-scrollbar">
            {/* Kumpulan Utama */}
            <div>
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Papan Utama
              </p>
              <div className="space-y-1">
                <button
                  onClick={() => switchTab(2)}
                  id="sidebar-tab-2"
                  className={`sidebar-link ${
                    currentTab === 2 ? 'active' : ''
                  } w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium text-sm`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                    ></path>
                  </svg>
                  <span>🔑 Log Masuk &amp; Sekolah</span>
                </button>
                <button
                  onClick={() => switchTab(1)}
                  id="sidebar-tab-1"
                  className={`sidebar-link ${
                    currentTab === 1 ? 'active' : ''
                  } w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium text-sm`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    ></path>
                  </svg>
                  <span>🏫 Daftar Sekolah Baru</span>
                </button>
              </div>
            </div>

            {/* Kumpulan Data Asas */}
            <div id="nav-group-data">
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Maklumat Asas
              </p>
              <div className="space-y-1">
                <button
                  onClick={() => navigateToSecuredTab(3)}
                  id="sidebar-tab-3"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 3 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                      ></path>
                    </svg>
                    <span>👨‍🏫 Pengurusan Guru</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(10)}
                  id="sidebar-tab-10"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 10 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      ></path>
                    </svg>
                    <span>🏷️ Pengurusan Tahap</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(4)}
                  id="sidebar-tab-4"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 4 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                      ></path>
                    </svg>
                    <span>🏫 Pengurusan Kelas</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(5)}
                  id="sidebar-tab-5"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 5 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      ></path>
                    </svg>
                    <span>📚 Mata Pelajaran</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
              </div>
            </div>

            {/* Pemetaan & Laporan */}
            <div id="nav-group-mapping">
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Pemetaan &amp; Analisis
              </p>
              <div className="space-y-1">
                <button
                  onClick={() => navigateToSecuredTab(6)}
                  id="sidebar-tab-6"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 6 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 5H7a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                      ></path>
                    </svg>
                    <span>✏️ Matriks Pengajaran</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(7)}
                  id="sidebar-tab-7"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 7 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14m-6 0h6"
                      ></path>
                    </svg>
                    <span>📊 Laporan Pemetaan Guru</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(8)}
                  id="sidebar-tab-8"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 8 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                      ></path>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                      ></path>
                    </svg>
                    <span>📈 Laporan Pemetaan Kelas</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(9)}
                  id="sidebar-tab-9"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 9 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                      ></path>
                    </svg>
                    <span>🖨️ Pemetaan Kelas PDF</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
                <button
                  onClick={() => navigateToSecuredTab(11)}
                  id="sidebar-tab-11"
                  className={`sidebar-link ${!currentUser ? 'locked' : ''} ${
                    currentTab === 11 ? 'active' : ''
                  } w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-50 font-medium text-sm`}
                >
                  <div className="flex items-center space-x-3">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                      ></path>
                    </svg>
                    <span>🖨️ Pemetaan Guru PDF</span>
                  </div>
                  {!currentUser && <span className="lock-icon text-xs">🔒</span>}
                </button>
              </div>
            </div>
          </div>

          {/* Footer Info */}
          <div className="p-4 border-t border-slate-100 bg-slate-50 text-center">
            <p className="text-xxs text-slate-400 font-medium">
              &copy; 2026 Sistem Pemetaan Jadual v2.0 by king/nothing
            </p>
          </div>
        </aside>

        {/* MOBILE BAR / BOTTOM NAVIGATION (Mobile Only) */}
        <header className="md:hidden bg-indigo-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center space-x-2">
            <span className="text-xl">📅</span>
            <h1 className="text-md font-bold tracking-tight">Sistem Jadual</h1>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => switchTab(2)}
              className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-800 rounded text-xs font-semibold"
            >
              Sekolah
            </button>
            <button
              id="mobile-logout-indicator"
              className={`${
                currentUser ? '' : 'hidden'
              } px-2 py-1 bg-rose-600 hover:bg-rose-700 rounded text-xs font-semibold`}
              onClick={handleLogout}
            >
              Keluar
            </button>
          </div>
        </header>

        {/* Bottom Mobile Nav Bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 flex justify-around py-2 shadow-lg">
          <button
            onClick={() => switchTab(2)}
            className="mobile-nav-btn flex flex-col items-center justify-center text-slate-500 hover:text-indigo-600"
          >
            <span className="text-lg">🔑</span>
            <span className="text-[10px] mt-0.5">Sekolah</span>
          </button>
          <button
            onClick={() => navigateToSecuredTab(3)}
            className="mobile-nav-btn flex flex-col items-center justify-center text-slate-400 hover:text-indigo-600"
          >
            <span className="text-lg">👨‍🏫</span>
            <span className="text-[10px] mt-0.5">Guru</span>
          </button>
          <button
            onClick={() => navigateToSecuredTab(4)}
            className="mobile-nav-btn flex flex-col items-center justify-center text-slate-400 hover:text-indigo-600"
          >
            <span className="text-lg">🏫</span>
            <span className="text-[10px] mt-0.5">Kelas</span>
          </button>
          <button
            onClick={() => navigateToSecuredTab(6)}
            className="mobile-nav-btn flex flex-col items-center justify-center text-slate-400 hover:text-indigo-600"
          >
            <span className="text-lg">✏️</span>
            <span className="text-[10px] mt-0.5">Pemetaan</span>
          </button>
          <button
            onClick={() => navigateToSecuredTab(9)}
            className="mobile-nav-btn flex flex-col items-center justify-center text-slate-400 hover:text-indigo-600"
          >
            <span className="text-lg">🖨️</span>
            <span className="text-[10px] mt-0.5">Cetak</span>
          </button>
        </div>

        {/* MAIN WINDOW / KANDUNGAN UTAMA */}
        <main className="flex-1 overflow-y-auto px-4 py-6 md:p-8 lg:p-10 pb-20 md:pb-8">
          {/* Top Dynamic Header with Status */}
          <div className="max-w-7xl mx-auto mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 id="section-header-title" className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                {headerTitle}
              </h2>
              <p id="section-header-desc" className="text-slate-500 text-sm mt-1">
                {headerDesc}
              </p>
            </div>
            {/* Status & Auth Trigger */}
            <div className="flex items-center gap-3 self-start sm:self-center">
              {!currentUser && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthPopupMode('login');
                    setAuthPopupOpen(true);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Log Masuk / Daftar
                </button>
              )}
              <div className="flex items-center gap-2">
                <span className="flex h-3.5 w-3.5 relative">
                  <span
                    id="pulse-dot"
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full ${
                      currentUser ? 'bg-emerald-400' : 'bg-amber-400'
                    } opacity-75`}
                  ></span>
                  <span
                    id="status-dot"
                    className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                      currentUser ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  ></span>
                </span>
                <span id="status-text" className="text-sm font-semibold text-slate-600">
                  {currentUser ? currentUser.name : 'Belum Log Masuk'}
                </span>
              </div>
            </div>
          </div>

          {/* APP CONTENT PORTALS */}
          <div className="max-w-7xl mx-auto">
            {/* SECTION 1: DAFTAR PENGGUNA (SCHOOL REGISTRATION) */}
            {currentTab === 1 && (
              <div
                id="section-1"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="max-w-2xl">
                  <div className="flex items-center space-x-3 mb-6">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                        ></path>
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">
                      Pendaftaran Kod &amp; Profil Sekolah Baru
                    </h3>
                  </div>

                  <p className="text-slate-600 text-sm mb-6">
                    Daftarkan kod sekolah anda sebagai pengenalan unik pangkalan data. Anda boleh mengakses semula data pemetaan anda bila-bila masa menggunakan kod dan kata laluan ini.
                  </p>

                  <div className="space-y-4 mb-6 bg-slate-50 p-5 rounded-xl border border-slate-100">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                          Kod Sekolah
                        </label>
                        <input
                          type="text"
                          id="new-user-name"
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          placeholder="Contoh: ABA1001"
                          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all uppercase placeholder-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                          Nama Sekolah
                        </label>
                        <input
                          type="text"
                          id="new-user-username"
                          value={newUserUsername}
                          onChange={(e) => setNewUserUsername(e.target.value)}
                          placeholder="Contoh: SK CONVENT SENTUL"
                          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all uppercase placeholder-slate-400"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                        Kata Laluan Sekolah
                      </label>
                      <div className="relative">
                        <input
                          type={showNewUserPassword ? 'text' : 'password'}
                          id="new-user-password"
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          placeholder="Min. 4 Aksara"
                          className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all placeholder-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewUserPassword((v) => !v)}
                          className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
                        >
                          👁️
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      id="save-user-btn"
                      disabled={savingUser}
                      onClick={saveUser}
                      className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm shadow-indigo-100 flex items-center gap-2 transition-all"
                    >
                      <span>{savingUser ? '⏳ Menyimpan...' : '💾 Simpan Profil'}</span>
                    </button>
                    <button
                      onClick={() => {
                        hideForm('user');
                        switchTab(2);
                      }}
                      className="px-5 py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg font-semibold transition-all"
                    >
                      Batal
                    </button>
                    <button
                      onClick={injectDemoData}
                      className="px-5 py-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-bold border border-emerald-200/50 flex items-center gap-1 transition-all ml-auto"
                    >
                      ⚡ Guna Contoh Data (Demo)
                    </button>
                  </div>
                </div>

                {/* List of Registered Schools for Admin Reference */}
                <div className="mt-12 pt-8 border-t border-slate-200">
                  <h4 className="text-md font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <span>📋 Senarai Sekolah Berdaftar</span>
                    <span
                      id="registered-schools-count"
                      className="px-2.5 py-0.5 text-xs bg-slate-100 text-slate-700 rounded-full font-bold"
                    >
                      {usersList.length}
                    </span>
                  </h4>
                  <div id="users-list" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {renderCardList('users', usersList)}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 2: LOG MASUK (SCHOOL LOGIN) */}
            {currentTab === 2 && (
              <div
                id="section-2"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                  {/* Left Info Panel */}
                  <div className="lg:col-span-7 space-y-6">
                    <div className="inline-flex items-center px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider">
                      Sistem Pemetaan v2.0 Premium
                    </div>
                    <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
                      Urus Tugasan Guru &amp; Kelas Secara Sistematik
                    </h3>
                    <p className="text-slate-600 text-base leading-relaxed">
                      Sistem ini membolehkan Penolong Kanan Pentadbiran memetakan guru-guru mata pelajaran ke kelas dengan pengesanan beban tugas yang sistematik bagi memastikan pembahagian jadual adalah seimbang di seluruh sekolah.
                    </p>

                    {/* Quick Feature List */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-start space-x-3">
                        <span className="text-indigo-600 text-lg">💡</span>
                        <div>
                          <h4 className="text-sm font-bold text-slate-800">Had Waktu Guru</h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Analisis visual waktu mengajar mingguan guru berbanding had beban tugas.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <span className="text-indigo-600 text-lg">✏️</span>
                        <div>
                          <h4 className="text-sm font-bold text-slate-800">Fleksibiliti Pemetaan</h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Seorang guru boleh memegang subjek yang sama merentas pelbagai kelas berbeza.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <span className="text-indigo-600 text-lg">📈</span>
                        <div>
                          <h4 className="text-sm font-bold text-slate-800">Laporan Komprehensif</h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Laporan pemetaan guru, kelas dan jumlah waktu dihitung secara automatik.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3">
                        <span className="text-indigo-600 text-lg">🖨️</span>
                        <div>
                          <h4 className="text-sm font-bold text-slate-800">Cetak PDF</h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Eksport jadual matriks pemetaan lengkap bersaiz A4 landskap.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Login Form */}
                  <div className="lg:col-span-5 bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <h4 className="text-lg font-bold text-slate-900 mb-4">Log Masuk Ke Sekolah</h4>

                    {!currentUser ? (
                      <div id="logged-out-form-group" className="space-y-4">
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                            Masukkan Atau Pilih Kod Sekolah
                          </label>
                          <input
                            type="text"
                            id="user-code-input"
                            autoComplete="off"
                            value={loginSchoolCode}
                            onChange={(e) => {
                              const val = e.target.value;
                              setLoginSchoolCode(val);
                              const norm = val.trim().toUpperCase();
                              const matched = usersList.find(
                                (u) =>
                                  (u.name || '').toUpperCase() === norm ||
                                  (u.username || '').toUpperCase() === norm ||
                                  `${(u.name || '').toUpperCase()} - ${(u.username || '').toUpperCase()}` ===
                                    norm
                              );
                              setSelectedUserId(matched ? matched.id : '');
                            }}
                            placeholder="Taip Kod Sekolah (cth: ABA1001)..."
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none bg-white transition-all uppercase placeholder-slate-400 text-sm font-semibold"
                          />
                          <select
                            id="user-select"
                            value={selectedUserId}
                            onChange={(e) => {
                              const id = e.target.value;
                              setSelectedUserId(id);
                              const found = usersList.find((u) => u.id === id);
                              setLoginSchoolCode(found ? found.name || '' : '');
                            }}
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none bg-white transition-all text-sm"
                          >
                            <option value="">-- Atau Pilih Dari Senarai Sekolah --</option>
                            {usersList.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name} - {user.username}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                            Kata Laluan Sekolah
                          </label>
                          <div className="relative">
                            <input
                              ref={loginPasswordRef}
                              type={showLoginPassword ? 'text' : 'password'}
                              id="login-password"
                              value={loginPassword}
                              onChange={(e) => setLoginPassword(e.target.value)}
                              placeholder="Masukkan kata laluan"
                              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all placeholder-slate-400"
                            />
                            <button
                              type="button"
                              onClick={() => setShowLoginPassword((v) => !v)}
                              className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
                            >
                              👁️
                            </button>
                          </div>
                        </div>

                        {loginError && (
                          <div
                            id="login-error-message"
                            className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start space-x-2"
                          >
                            <span className="text-rose-600 text-md mt-0.5">❌</span>
                            <div>
                              <p className="text-rose-700 text-xs font-bold">Kata Laluan Salah</p>
                              <p className="text-rose-600 text-xxs mt-0.5">
                                Sila semak semula atau rujuk pendaftar kod sekolah.
                              </p>
                            </div>
                          </div>
                        )}

                        {usersList.length === 0 && (
                          <div
                            id="no-users-message"
                            className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-center"
                          >
                            <p className="text-amber-800 text-xs font-bold">Tiada Rekod Sekolah Berdaftar</p>
                            <p className="text-amber-600 text-xxs mt-1 mb-3">
                              Daftarkan profil sekolah baharu untuk mula.
                            </p>
                            <button
                              onClick={() => switchTab(1)}
                              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold transition-all"
                            >
                              Daftar Sekolah Baru
                            </button>
                          </div>
                        )}

                        <button
                          id="login-btn"
                          disabled={usersList.length === 0}
                          onClick={handleLogin}
                          className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-lg hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center justify-center space-x-2 disabled:opacity-50"
                        >
                          <span>Log Masuk</span>
                        </button>
                      </div>
                    ) : (
                      <div id="current-user-display" className="space-y-4">
                        <div className="p-4 bg-emerald-50 border border-emerald-200/60 rounded-xl text-center space-y-2">
                          <span className="text-4xl">🏫</span>
                          <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                            Anda sedang mengakses profil
                          </p>
                          <p id="current-user" className="text-lg font-bold text-emerald-800 leading-tight uppercase">
                            {currentUser.name}
                          </p>
                          <div className="pt-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                              Aktif &amp; Selamat
                            </span>
                          </div>
                        </div>
                        <button
                          id="logout-btn"
                          onClick={handleLogout}
                          className="w-full bg-slate-200 text-slate-700 font-bold py-2.5 rounded-lg hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 border border-transparent transition-all"
                        >
                          🔑 Log Keluar Dari Profil Sekolah
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: SENARAI GURU (TEACHER MANAGEMENT) */}
            {currentTab === 3 && (
              <div
                id="section-3"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Pengurusan Guru Sekolah</h3>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Daftar, ubah, atau padam rekod nama guru dan singkatan untuk sistem jadual.
                    </p>
                  </div>
                  <button
                    id="add-teacher-btn"
                    onClick={() => openAddForm('teacher')}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1 transition-all"
                  >
                    <span>➕ Tambah Rekod Guru</span>
                  </button>
                </div>

                {/* Add / Edit Teacher Form Overlay Container */}
                {showTeacherForm && (
                  <div
                    id="add-teacher-form"
                    className="mb-6 p-5 bg-slate-50 rounded-xl border border-slate-200 fade-in"
                  >
                    <h4
                      id="teacher-form-title"
                      className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4"
                    >
                      {editingItem ? 'Ubah Data Guru' : 'Daftar Guru Baru'}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Nama Penuh Guru
                        </label>
                        <input
                          type="text"
                          id="new-teacher-name"
                          value={newTeacherName}
                          onChange={(e) => setNewTeacherName(e.target.value)}
                          placeholder="Contoh: AHMAD SHAH BIN ROSLI"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all uppercase text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Singkatan / Kod Nama
                        </label>
                        <input
                          type="text"
                          id="new-teacher-shortname"
                          value={newTeacherShortname}
                          onChange={(e) => setNewTeacherShortname(e.target.value)}
                          placeholder="Contoh: EN. AHMAD"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all uppercase text-sm"
                        />
                      </div>
                    </div>
                    <div className="mb-4 max-w-xs">
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                        Had Maksimum Waktu Mengajar Seminggu
                      </label>
                      <input
                        type="number"
                        id="new-teacher-max-hours"
                        value={newTeacherMaxHours}
                        onChange={(e) => setNewTeacherMaxHours(e.target.value)}
                        min="1"
                        max="100"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all text-sm"
                      />
                    </div>
                    <div className="flex space-x-2">
                      <button
                        id="save-teacher-btn"
                        disabled={savingTeacher}
                        onClick={saveTeacher}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold text-sm transition-all"
                      >
                        💾 Simpan Data
                      </button>
                      <button
                        id="cancel-teacher-btn"
                        onClick={() => hideForm('teacher')}
                        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-semibold text-sm transition-all"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                {/* Interactive Search Filter */}
                <div className="mb-4">
                  <input
                    type="text"
                    id="teacher-search"
                    value={teacherSearch}
                    onChange={(e) => setTeacherSearch(e.target.value)}
                    placeholder="🔍 Cari Guru melalui nama..."
                    className="w-full max-w-md px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Teachers List Row / Table Mode */}
                <div id="teachers-list" className="w-full">
                  {!currentUser ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-4xl block mb-2">🔒</span>
                      <p className="text-sm font-semibold">Sila log masuk untuk melihat rekod maklumat.</p>
                    </div>
                  ) : filteredTeachers.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-3xl block mb-2">📂</span>
                      <p className="text-sm font-semibold">Tiada sebarang data disimpan setakat ini.</p>
                      <p className="text-xs mt-1">Sila tambah rekod baru menggunakan butang di atas.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200/80 rounded-xl shadow-xs bg-white">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
                            <th className="py-3.5 px-4 w-16 text-center">Bil.</th>
                            <th className="py-3.5 px-4">Nama Penuh Guru</th>
                            <th className="py-3.5 px-4">Singkatan / Kod Nama</th>
                            <th className="py-3.5 px-4 text-center">Had Waktu Seminggu</th>
                            <th className="py-3.5 px-4 text-right w-44">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {filteredTeachers.map((item, index) => (
                            <tr
                              key={item.id}
                              className="hover:bg-indigo-50/40 transition-colors duration-150"
                            >
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xxs">
                                  #{index + 1}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <span className="text-base shrink-0">👨‍🏫</span>
                                  <span className="font-bold text-slate-800 uppercase tracking-tight">
                                    {item.name}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs uppercase">
                                  {item.subject || '-'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
                                  ⚡ <strong className="text-slate-800">{item.maxHours || 30}</strong> waktu
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => editItem('teachers', item.id)}
                                    className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200/80 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                  >
                                    ✏️ Edit
                                  </button>
                                  <button
                                    onClick={() => confirmDeleteItem(item.id, item.name || '')}
                                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                  >
                                    🗑️ Padam
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 4: SENARAI KELAS (CLASS MANAGEMENT) */}
            {currentTab === 4 && (
              <div
                id="section-4"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Pengurusan Kelas</h3>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Daftarkan kelas-kelas di sekolah dan tetapkan Guru Kelas mereka.
                    </p>
                  </div>
                  <button
                    id="add-class-btn"
                    onClick={() => openAddForm('class')}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1 transition-all"
                  >
                    <span>➕ Tambah Rekod Kelas</span>
                  </button>
                </div>

                {/* Add / Edit Class Form */}
                {showClassForm && (
                  <div
                    id="add-class-form"
                    className="mb-6 p-5 bg-slate-50 rounded-xl border border-slate-200 fade-in"
                  >
                    <h4
                      id="class-form-title"
                      className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4"
                    >
                      {editingItem ? 'Ubah Data Kelas' : 'Daftar Kelas Baru'}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Tahun
                        </label>
                        <select
                          id="new-class-year"
                          value={newClassYear}
                          onChange={(e) => {
                            const selectedYear = e.target.value;
                            setNewClassYear(selectedYear);
                            setNewClassLevel(resolveTahapFromTahun(selectedYear));
                          }}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-indigo-500 text-sm"
                        >
                          <option value="Tahun 1">Tahun 1</option>
                          <option value="Tahun 2">Tahun 2</option>
                          <option value="Tahun 3">Tahun 3</option>
                          <option value="Tahun 4">Tahun 4</option>
                          <option value="Tahun 5">Tahun 5</option>
                          <option value="Tahun 6">Tahun 6</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Tahap
                        </label>
                        <select
                          id="new-class-level"
                          value={newClassLevel}
                          onChange={(e) => setNewClassLevel(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-indigo-500 text-sm"
                        >
                          <option value="Tahap 1">Tahap 1</option>
                          <option value="Tahap 2">Tahap 2</option>
                          <option value="Tahap 3">Tahap 3</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Nama Kelas
                        </label>
                        <input
                          type="text"
                          id="new-class-name"
                          value={newClassName}
                          onChange={(e) => setNewClassName(e.target.value)}
                          placeholder="Contoh: 1 CERDIK"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all uppercase text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Nama Kelas (Short)
                        </label>
                        <input
                          type="text"
                          id="new-class-shortname"
                          value={newClassShortname}
                          onChange={(e) => setNewClassShortname(e.target.value)}
                          placeholder="Contoh: 1C"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all uppercase text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Guru Kelas
                        </label>
                        <select
                          id="new-class-teacher"
                          value={newClassTeacher}
                          onChange={(e) => setNewClassTeacher(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-indigo-500 text-sm"
                        >
                          <option value="">-- Sila Pilih --</option>
                          {schoolTeachers.map((teacher) => {
                            const isAlreadyClassTeacher = allData.some(
                              (c) =>
                                c.type === 'class' &&
                                c.role === teacher.id &&
                                (!editingItem || c.id !== editingItem.id)
                            );
                            return (
                              <option key={teacher.id} value={teacher.id}>
                                {teacher.name}
                                {isAlreadyClassTeacher ? ' ⚠️ (Sudah menjadi guru kelas)' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        id="save-class-btn"
                        disabled={savingClass}
                        onClick={saveClass}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold text-sm transition-all"
                      >
                        💾 Simpan Data
                      </button>
                      <button
                        id="cancel-class-btn"
                        onClick={() => hideForm('class')}
                        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-semibold text-sm transition-all"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                {/* Classes List Row / Table Mode */}
                <div id="classes-list" className="w-full">
                  {!currentUser ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-4xl block mb-2">🔒</span>
                      <p className="text-sm font-semibold">Sila log masuk untuk melihat rekod maklumat.</p>
                    </div>
                  ) : schoolClasses.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-3xl block mb-2">📂</span>
                      <p className="text-sm font-semibold">Tiada sebarang data disimpan setakat ini.</p>
                      <p className="text-xs mt-1">Sila tambah rekod baru menggunakan butang di atas.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200/80 rounded-xl shadow-xs bg-white">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
                            <th className="py-3.5 px-4 w-16 text-center">Bil.</th>
                            <th className="py-3.5 px-4">Tahun</th>
                            <th className="py-3.5 px-4">Tahap</th>
                            <th className="py-3.5 px-4">Nama Kelas</th>
                            <th className="py-3.5 px-4">Nama Kelas (Short)</th>
                            <th className="py-3.5 px-4">Guru Kelas</th>
                            <th className="py-3.5 px-4 text-right w-44">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {schoolClasses.map((item, index) => {
                            let teacherName = 'Tiada Guru Kelas';
                            if (item.role) {
                              const teacher = allData.find((t) => t.id === item.role);
                              if (teacher && teacher.name) teacherName = teacher.name;
                            }
                            const levelBadgeColor =
                              item.level === 'Tahap 1'
                                ? 'bg-blue-100 text-blue-800'
                                : item.level === 'Tahap 3'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-emerald-100 text-emerald-800';
                            return (
                              <tr
                                key={item.id}
                                className="hover:bg-indigo-50/40 transition-colors duration-150"
                              >
                                <td className="py-3 px-4 text-center">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xxs">
                                    #{index + 1}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <span className="inline-block px-2.5 py-1 text-xs font-bold bg-indigo-50 text-indigo-700 rounded-md">
                                    {item.class_id || '-'}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`inline-block px-2.5 py-1 text-xs font-bold ${levelBadgeColor} rounded-md`}
                                  >
                                    {item.level || 'Tahap 1'}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base shrink-0">🎒</span>
                                    <span className="font-bold text-slate-800 uppercase tracking-tight">
                                      {item.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-bold text-xs uppercase">
                                    {item.subject || '-'}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <span className="text-xs font-bold text-indigo-600 uppercase">
                                    👩‍🏫 {teacherName}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => editItem('classes', item.id)}
                                      className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200/80 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                    >
                                      ✏️ Edit
                                    </button>
                                    <button
                                      onClick={() => confirmDeleteItem(item.id, item.name || '')}
                                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                    >
                                      🗑️ Padam
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 5: SENARAI MATA PELAJARAN (SUBJECT MANAGEMENT) */}
            {currentTab === 5 && (
              <div
                id="section-5"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Pengurusan Mata Pelajaran</h3>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Urus senarai mata pelajaran dan tetapkan peruntukan masa waktu (periods) seminggu mengikut tahap.
                    </p>
                  </div>
                  <button
                    id="add-subject-btn"
                    onClick={() => openAddForm('subject')}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1 transition-all"
                  >
                    <span>➕ Tambah Mata Pelajaran</span>
                  </button>
                </div>

                {/* Add / Edit Subject Form */}
                {showSubjectForm && (
                  <div
                    id="add-subject-form"
                    className="mb-6 p-5 bg-slate-50 rounded-xl border border-slate-200 fade-in"
                  >
                    <h4
                      id="subject-form-title"
                      className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4"
                    >
                      {editingItem ? 'Ubah Data Mata Pelajaran' : 'Daftar Mata Pelajaran Baru'}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Nama Subjek
                        </label>
                        <input
                          type="text"
                          id="new-subject-name"
                          value={newSubjectName}
                          onChange={(e) => setNewSubjectName(e.target.value)}
                          placeholder="Contoh: MATEMATIK"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all uppercase text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Short (Subjek)
                        </label>
                        <input
                          type="text"
                          id="new-subject-shortname"
                          value={newSubjectShortname}
                          onChange={(e) => setNewSubjectShortname(e.target.value)}
                          placeholder="Contoh: MT"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all uppercase text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Bil. Waktu Tahap 1
                        </label>
                        <input
                          type="number"
                          id="new-subject-time-t1"
                          value={newSubjectTimeT1}
                          onChange={(e) => setNewSubjectTimeT1(e.target.value)}
                          placeholder="Bilangan waktu"
                          min="1"
                          max="20"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Bil. Waktu Tahap 2
                        </label>
                        <input
                          type="number"
                          id="new-subject-time-t2"
                          value={newSubjectTimeT2}
                          onChange={(e) => setNewSubjectTimeT2(e.target.value)}
                          placeholder="Bilangan waktu"
                          min="1"
                          max="20"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Bil. Waktu Tahap 3
                        </label>
                        <input
                          type="number"
                          id="new-subject-time-t3"
                          value={newSubjectTimeT3}
                          onChange={(e) => setNewSubjectTimeT3(e.target.value)}
                          placeholder="Bilangan waktu"
                          min="1"
                          max="20"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500 transition-all text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        id="save-subject-btn"
                        disabled={savingSubject}
                        onClick={saveSubject}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold text-sm transition-all"
                      >
                        💾 Simpan Data
                      </button>
                      <button
                        id="cancel-subject-btn"
                        onClick={() => hideForm('subject')}
                        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-semibold text-sm transition-all"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                {/* Subjects List Row / Table Mode */}
                <div id="subjects-list" className="w-full">
                  {!currentUser ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-4xl block mb-2">🔒</span>
                      <p className="text-sm font-semibold">Sila log masuk untuk melihat rekod maklumat.</p>
                    </div>
                  ) : schoolSubjects.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-3xl block mb-2">📂</span>
                      <p className="text-sm font-semibold">Tiada sebarang data disimpan setakat ini.</p>
                      <p className="text-xs mt-1">Sila tambah rekod baru menggunakan butang di atas.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200/80 rounded-xl shadow-xs bg-white">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
                            <th className="py-3.5 px-4 w-16 text-center">Bil.</th>
                            <th className="py-3.5 px-4">Nama Subjek</th>
                            <th className="py-3.5 px-4">Short (Subjek)</th>
                            <th className="py-3.5 px-4 text-center">Bil. Waktu Tahap 1</th>
                            <th className="py-3.5 px-4 text-center">Bil. Waktu Tahap 2</th>
                            <th className="py-3.5 px-4 text-center">Bil. Waktu Tahap 3</th>
                            <th className="py-3.5 px-4 text-right w-44">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {schoolSubjects.map((item, index) => (
                            <tr
                              key={item.id}
                              className="hover:bg-indigo-50/40 transition-colors duration-150"
                            >
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xxs">
                                  #{index + 1}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-base shrink-0">📚</span>
                                  <span className="font-bold text-slate-800 uppercase tracking-tight">
                                    {item.name}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs uppercase">
                                  {item.class_id || '-'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md">
                                  ⏰ <strong>{item.role || '0'}</strong> waktu
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
                                  ⏰ <strong>{item.subject || '0'}</strong> waktu
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center">
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-md">
                                  ⏰ <strong>{item.subject_id || '0'}</strong> waktu
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => editItem('subjects', item.id)}
                                    className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200/80 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                  >
                                    ✏️ Edit
                                  </button>
                                  <button
                                    onClick={() => confirmDeleteItem(item.id, item.name || '')}
                                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                  >
                                    🗑️ Padam
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 10: PENGURUSAN TAHAP (LEVEL & YEAR MANAGEMENT) */}
            {currentTab === 10 && (
              <div
                id="section-10"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Pengurusan Tahap</h3>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Tetapkan klasifikasi Tahap (Tahap 1, 2, 3) dan Tahun (Tahun 1 hingga 6) bagi sekolah anda.
                    </p>
                  </div>
                  <button
                    id="add-level-btn"
                    onClick={() => openAddForm('level')}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1 transition-all"
                  >
                    <span>➕ Tambah Rekod Tahap</span>
                  </button>
                </div>

                {/* Add / Edit Level Form */}
                {showLevelForm && (
                  <div
                    id="add-level-form"
                    className="mb-6 p-5 bg-slate-50 rounded-xl border border-slate-200 fade-in"
                  >
                    <h4
                      id="level-form-title"
                      className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4"
                    >
                      {editingItem ? 'Ubah Data Tahap' : 'Daftar Tahap Baru'}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Tahap
                        </label>
                        <select
                          id="new-level-tahap"
                          value={newLevelTahap}
                          onChange={(e) => setNewLevelTahap(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-indigo-500 text-sm"
                        >
                          <option value="Tahap 1">Tahap 1</option>
                          <option value="Tahap 2">Tahap 2</option>
                          <option value="Tahap 3">Tahap 3</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                          Tahun
                        </label>
                        <select
                          id="new-level-tahun"
                          value={newLevelTahun}
                          onChange={(e) => setNewLevelTahun(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-indigo-500 text-sm"
                        >
                          <option value="Tahun 1">Tahun 1</option>
                          <option value="Tahun 2">Tahun 2</option>
                          <option value="Tahun 3">Tahun 3</option>
                          <option value="Tahun 4">Tahun 4</option>
                          <option value="Tahun 5">Tahun 5</option>
                          <option value="Tahun 6">Tahun 6</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        id="save-level-btn"
                        disabled={savingLevel}
                        onClick={saveLevel}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold text-sm transition-all"
                      >
                        💾 Simpan Data
                      </button>
                      <button
                        id="cancel-level-btn"
                        onClick={() => hideForm('level')}
                        className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 font-semibold text-sm transition-all"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                {/* Levels List Row / Table Mode */}
                <div id="levels-list" className="w-full">
                  {!currentUser ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-4xl block mb-2">🔒</span>
                      <p className="text-sm font-semibold">Sila log masuk untuk melihat rekod maklumat.</p>
                    </div>
                  ) : schoolLevels.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-3xl block mb-2">📂</span>
                      <p className="text-sm font-semibold">Tiada sebarang data disimpan setakat ini.</p>
                      <p className="text-xs mt-1">Sila tambah rekod baru menggunakan butang di atas.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200/80 rounded-xl shadow-xs bg-white">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
                            <th className="py-3.5 px-4 w-16 text-center">Bil.</th>
                            <th className="py-3.5 px-4">Tahap</th>
                            <th className="py-3.5 px-4">Tahun</th>
                            <th className="py-3.5 px-4 text-right w-44">Tindakan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {schoolLevels.map((item, index) => {
                            const levelName = item.level || item.name || 'Tahap 1';
                            const levelBadgeColor =
                              levelName === 'Tahap 1'
                                ? 'bg-blue-100 text-blue-800'
                                : levelName === 'Tahap 3'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-emerald-100 text-emerald-800';
                            return (
                              <tr
                                key={item.id}
                                className="hover:bg-indigo-50/40 transition-colors duration-150"
                              >
                                <td className="py-3 px-4 text-center">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 font-bold text-xxs">
                                    #{index + 1}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold ${levelBadgeColor} rounded-md uppercase`}
                                  >
                                    🏷️ {levelName}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-md uppercase">
                                    📅 {item.role || 'Tahun 1'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => editItem('levels', item.id)}
                                      className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200/80 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                    >
                                      ✏️ Edit
                                    </button>
                                    <button
                                      onClick={() =>
                                        confirmDeleteItem(item.id, `${item.name} - ${item.role}`)
                                      }
                                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold text-xs transition flex items-center gap-1"
                                    >
                                      🗑️ Padam
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 6: TAG PENGAJARAN (TEACHING ASSIGNMENT MATRIX) */}
            {currentTab === 6 && (
              <div
                id="section-6"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Matriks Pemetaan Pengajaran</h3>
                    <p className="text-slate-500 text-xs mt-0.5">
                      Urus gandingan guru dan subjek di dalam kelas. Jumlah waktu beban guru akan dihitung secara automatik.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:items-stretch shrink-0">
                    <button
                      type="button"
                      onClick={confirmClearAssignments}
                      className="px-3.5 py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 rounded-lg font-bold text-slate-600 text-sm border border-transparent hover:border-rose-100 transition-all cursor-pointer"
                    >
                      🗑️ Padam Semua Gandingan
                    </button>
                    <button
                      type="button"
                      onClick={exportSchoolDataJson}
                      className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-sm border border-indigo-200/80 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      📥 Eksport Data (JSON)
                    </button>
                  </div>
                </div>

                {/* Interactive Help Banner */}
                <div className="mb-6 p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-start space-x-3">
                  <span className="text-indigo-600 text-lg">ℹ️</span>
                  <div className="text-xs text-indigo-800 leading-relaxed">
                    <p className="font-bold">Panduan Matriks Pemetaan:</p>
                    <p className="mt-0.5">
                      1. Matriks memaparkan semua kelas berdaftar di bahagian baris, dan mata pelajaran di bahagian lajur.
                    </p>
                    <p>
                      2. Pilih nama guru dari senarai bagi setiap kotak sel kelas - subjek. Tekan + untuk masukkan nama guru pairing (sehingga 3 orang guru) jika ada
                    </p>
                    <p>
                      3. Sistem akan mengira jumlah peruntukan waktu mengajar mingguan guru secara automatik di Tab Laporan Pemetaan Guru.
                    </p>
                  </div>
                </div>

                {/* Matrix Table Outer Container for horizontal scroll */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div id="schedule-table" className="overflow-x-auto custom-scrollbar">
                    {!currentUser ? (
                      <div className="text-center py-12 text-slate-400 bg-slate-50">
                        <span className="text-4xl block mb-2">🔒</span>
                        <p className="text-sm font-semibold">
                          Sila log masuk untuk mengurus jadual pengajaran.
                        </p>
                      </div>
                    ) : schoolClasses.length === 0 || schoolSubjects.length === 0 ? (
                      <div className="text-center py-12 text-slate-400 bg-slate-50">
                        <span className="text-3xl block mb-2">📋</span>
                        <p className="text-sm font-bold">
                          Sila pastikan data Kelas dan Mata Pelajaran diisi terlebih dahulu.
                        </p>
                        <p className="text-xs mt-1">
                          Sistem memerlukan rekod asas untuk menjana matriks.
                        </p>
                      </div>
                    ) : (
                      <table className="w-full border-separate border-spacing-0 border border-slate-200 text-sm whitespace-nowrap">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 text-left">
                            <th className="sticky left-0 z-20 bg-slate-100 border-r border-b border-slate-200 p-4 text-center font-extrabold text-slate-600 w-16 min-w-[4rem]">
                              BIL.
                            </th>
                            <th className="sticky left-16 z-20 bg-slate-100 border-r border-b border-slate-200 p-4 font-extrabold text-slate-600 w-44 min-w-[11rem] shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                              KELAS \ SUBJEK
                            </th>
                            {schoolSubjects.map((subject) => (
                              <th
                                key={subject.id}
                                title={subject.name}
                                className="border-r border-b border-slate-200 px-3 py-3.5 font-extrabold text-slate-700 text-center uppercase tracking-tight w-auto whitespace-nowrap bg-slate-100"
                              >
                                {subject.class_id || subject.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {schoolClasses.map((cls, index) => (
                            <tr key={cls.id} className="hover:bg-indigo-50/20 transition-colors">
                              <td className="sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-200 p-4 text-center font-bold text-indigo-600 w-16 min-w-[4rem]">
                                {index + 1}
                              </td>
                              <td className="sticky left-16 z-10 bg-slate-50 border-r border-b border-slate-200 p-4 font-extrabold text-slate-800 w-44 min-w-[11rem] shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                                <div className="flex flex-col">
                                  <span>🎒 {cls.name}</span>
                                  <span className="text-[10px] font-bold text-slate-400 tracking-wider mt-0.5 uppercase">
                                    {cls.level || 'Tahap 1'}
                                  </span>
                                </div>
                              </td>
                              {schoolSubjects.map((subject) => {
                                const cellKey = `${cls.id}_${subject.id}`;
                                const assignment = schoolAssignments.find(
                                  (a) => a.class_id === cls.id && a.subject_id === subject.id
                                );
                                const assignedTeacher = assignment
                                  ? schoolTeachers.find((t) => t.id === assignment.teacher_id)
                                  : null;
                                const assignedTeacher2 =
                                  assignment && assignment.role
                                    ? schoolTeachers.find((t) => t.id === assignment.role)
                                    : null;
                                const assignedTeacher3 =
                                  assignment && assignment.subject
                                    ? schoolTeachers.find((t) => t.id === assignment.subject)
                                    : null;
                                const showThirdSlot =
                                  Boolean(assignment?.subject) ||
                                  Boolean(expandedThirdTeacherCells[cellKey]);
                                const showSecondSlot =
                                  Boolean(assignment?.role) ||
                                  Boolean(expandedSecondTeacherCells[cellKey]) ||
                                  showThirdSlot;
                                const highlightBg =
                                  assignedTeacher || assignedTeacher2 || assignedTeacher3
                                    ? 'bg-emerald-50/30'
                                    : 'bg-slate-50/10';

                                return (
                                  <td
                                    key={subject.id}
                                    className={`border-r border-b border-slate-200 p-2 w-auto whitespace-nowrap transition-all duration-150 ${highlightBg}`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-max">
                                      <select
                                        value={assignedTeacher ? assignedTeacher.id : ''}
                                        onChange={(e) =>
                                          updateAssignment(cls.id, subject.id, e.target.value, 1)
                                        }
                                        className="matrix-select w-auto min-w-[115px] flex-1 pl-2.5 pr-7 py-1.5 border border-slate-200 focus:border-indigo-500 rounded-lg focus:outline-none text-xs font-semibold text-slate-700 bg-white"
                                      >
                                        <option value="">-- Tiada Guru --</option>
                                        {schoolTeachers.map((teacher) => (
                                          <option key={teacher.id} value={teacher.id}>
                                            {teacher.subject || teacher.name}
                                          </option>
                                        ))}
                                      </select>
                                      {!showSecondSlot && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedSecondTeacherCells((prev) => ({
                                              ...prev,
                                              [cellKey]: true,
                                            }))
                                          }
                                          title="Tambah Guru Kedua"
                                          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-sm border border-indigo-200/60 transition-all"
                                        >
                                          +
                                        </button>
                                      )}
                                    </div>
                                    {showSecondSlot && (
                                      <div className="flex items-center gap-1.5 mt-1.5 min-w-max">
                                        <select
                                          value={assignedTeacher2 ? assignedTeacher2.id : ''}
                                          onChange={(e) =>
                                            updateAssignment(cls.id, subject.id, e.target.value, 2)
                                          }
                                          className="matrix-select w-auto min-w-[115px] flex-1 pl-2.5 pr-7 py-1.5 border border-indigo-200 focus:border-indigo-500 rounded-lg focus:outline-none text-xs font-semibold text-slate-700 bg-white"
                                        >
                                          <option value="">-- Guru Kedua --</option>
                                          {schoolTeachers.map((teacher) => (
                                            <option key={teacher.id} value={teacher.id}>
                                              {teacher.subject || teacher.name}
                                            </option>
                                          ))}
                                        </select>
                                        {!showThirdSlot && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setExpandedThirdTeacherCells((prev) => ({
                                                ...prev,
                                                [cellKey]: true,
                                              }))
                                            }
                                            title="Tambah Guru Ketiga"
                                            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-sm border border-indigo-200/60 transition-all"
                                          >
                                            +
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateAssignment(cls.id, subject.id, '', 2)
                                          }
                                          title="Padam Guru Kedua"
                                          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs border border-rose-200/60 transition-all"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                    {showThirdSlot && (
                                      <div className="flex items-center gap-1.5 mt-1.5 min-w-max">
                                        <select
                                          value={assignedTeacher3 ? assignedTeacher3.id : ''}
                                          onChange={(e) =>
                                            updateAssignment(cls.id, subject.id, e.target.value, 3)
                                          }
                                          className="matrix-select w-auto min-w-[115px] flex-1 pl-2.5 pr-7 py-1.5 border border-indigo-200 focus:border-indigo-500 rounded-lg focus:outline-none text-xs font-semibold text-slate-700 bg-white"
                                        >
                                          <option value="">-- Guru Ketiga --</option>
                                          {schoolTeachers.map((teacher) => (
                                            <option key={teacher.id} value={teacher.id}>
                                              {teacher.subject || teacher.name}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateAssignment(cls.id, subject.id, '', 3)
                                          }
                                          title="Padam Guru Ketiga"
                                          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs border border-rose-200/60 transition-all"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 7: LAPORAN PEMETAAN GURU */}
            {currentTab === 7 && (
              <div
                id="section-7"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-slate-900">
                    Laporan Pemetaan &amp; Beban Tugas Guru
                  </h3>
                  <p className="text-slate-500 text-xs mt-0.5">
                    Rumusan bilangan waktu mengajar (periods) dan kelas-kelas bagi setiap guru dalam seminggu.
                  </p>
                </div>
                <div id="teacher-report" className="space-y-4">
                  {!currentUser ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-4xl block mb-2">🔒</span>
                      <p className="text-sm font-semibold">
                        Sila log masuk untuk melihat analisa beban guru.
                      </p>
                    </div>
                  ) : schoolTeachers.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-3xl block mb-2">📊</span>
                      <p className="text-sm font-bold">Tiada data guru berdaftar.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {teacherReportData.map((data) => {
                        const maxLimit = data.teacher.maxHours || 30;
                        const currentLoadRatio = (data.totalHours / maxLimit) * 100;
                        const isBurnout = data.totalHours > maxLimit;
                        const progressColor = isBurnout ? 'bg-rose-500' : 'bg-indigo-600';

                        return (
                          <div
                            key={data.teacher.id}
                            className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs hover:shadow-md transition-all"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <h4 className="font-extrabold text-slate-800 text-sm uppercase leading-tight">
                                  👨‍🏫 {data.teacher.name}
                                </h4>
                                <p className="text-xs text-indigo-600 font-bold tracking-wider mt-0.5 uppercase">
                                  {data.teacher.subject || 'GURU SEKOLAH'}
                                </p>
                              </div>
                              <div className="text-right">
                                <span className="text-2xl font-black text-indigo-700 leading-none">
                                  {data.totalHours.toFixed(0)}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400 block tracking-wider uppercase">
                                  waktu / minggu
                                </span>
                              </div>
                            </div>

                            {/* Visual Progress Bar Burden Indicator */}
                            <div className="mt-4">
                              <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                                <span>KPI Beban Tugas</span>
                                <span
                                  className={
                                    isBurnout ? 'text-rose-600 font-black' : 'text-slate-600'
                                  }
                                >
                                  {data.totalHours.toFixed(0)} / {maxLimit} waktu
                                </span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`${progressColor} h-2 rounded-full transition-all duration-500`}
                                  style={{ width: `${Math.min(currentLoadRatio, 100)}%` }}
                                ></div>
                              </div>
                              {isBurnout && (
                                <p className="text-xxs font-bold text-rose-600 mt-1">
                                  ⚠️ Melebihi beban maksimum waktu mengajar guru semak semula!
                                </p>
                              )}
                            </div>

                            <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Perincian Jadual:
                              </p>
                              {data.subjects.length === 0 ? (
                                <p className="text-xs text-slate-400 italic">
                                  Tiada subjek diamanahkan lagi.
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  {data.subjects.map((subj, sIdx) => {
                                    const allClasses = [
                                      ...subj.classesT1,
                                      ...subj.classesT2,
                                      ...subj.classesT3,
                                    ].sort();
                                    const t1Count = subj.classesT1.length;
                                    const t2Count = subj.classesT2.length;
                                    const t3Count = subj.classesT3.length;
                                    const t1Time = parseFloat(subj.timeT1) || 0;
                                    const t2Time = parseFloat(subj.timeT2) || 0;
                                    const t3Time = parseFloat(subj.timeT3) || 0;
                                    const subjectTotal =
                                      t1Count * t1Time + t2Count * t2Time + t3Count * t3Time;

                                    return (
                                      <div
                                        key={sIdx}
                                        className="flex items-start justify-between text-xs pb-1 border-b border-slate-50 last:border-0 last:pb-0 gap-2"
                                      >
                                        <span className="text-slate-700 font-semibold break-words flex-1">
                                          📖 {subj.subjectName} ({allClasses.join(', ')})
                                        </span>
                                        <span className="text-slate-600 font-bold shrink-0">
                                          {subjectTotal} Wkt
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 8: LAPORAN PEMETAAN KELAS */}
            {currentTab === 8 && (
              <div
                id="section-8"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-slate-900">Laporan Pemetaan Kelas</h3>
                  <p className="text-slate-500 text-xs mt-0.5">
                    Rumusan terperinci subjek, guru, dan jumlah waktu terkumpul seminggu bagi setiap kelas.
                  </p>
                </div>
                <div id="class-report" className="space-y-4">
                  {!currentUser ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-4xl block mb-2">🔒</span>
                      <p className="text-sm font-semibold">
                        Sila log masuk untuk melihat laporan analitik kelas.
                      </p>
                    </div>
                  ) : schoolClasses.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                      <span className="text-3xl block mb-2">📈</span>
                      <p className="text-sm font-bold">Tiada data kelas berdaftar.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {classReportData.map((data) => (
                        <div
                          key={data.class.id}
                          className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs hover:shadow-md transition-all"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-extrabold text-slate-800 text-sm uppercase leading-tight">
                                🎒 Kelas: {data.class.name}
                              </h4>
                              <p className="text-xs text-indigo-600 font-bold tracking-wider mt-0.5 uppercase">
                                👨‍🏫 Guru Kelas: {data.classTeacher}
                              </p>
                              <span
                                className={`inline-block px-2 py-0.5 text-[9px] font-bold ${
                                  data.class.level === 'Tahap 1'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-emerald-100 text-emerald-800'
                                } rounded-full mt-1.5`}
                              >
                                {data.class.level || 'Tahap 1'}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-2xl font-black text-indigo-700 leading-none">
                                {data.totalHours.toFixed(0)}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400 block tracking-wider uppercase">
                                Jumlah Waktu
                              </span>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Subjek &amp; Guru Gandingan:
                            </p>
                            {data.subjectTeachers.length === 0 ? (
                              <p className="text-xs text-slate-400 italic">
                                Tiada subjek dipetakan bagi kelas ini.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {data.subjectTeachers.map((st, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs pb-1 border-b border-slate-50 last:border-0 last:pb-0"
                                  >
                                    <div className="flex flex-col">
                                      <span className="text-slate-800 font-bold uppercase">
                                        {st.subjectName}
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-semibold">
                                        {st.teacherName}
                                      </span>
                                    </div>
                                    <span className="text-slate-600 font-bold">{st.time} waktu</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 9: CETAK & EKSPORT PDF */}
            {currentTab === 9 && (
              <div
                id="section-9"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-slate-900">Penjanaan Dokumen Cetak</h3>
                      <span className="hidden px-2.5 py-0.5 text-[11px] font-bold bg-indigo-50 text-indigo-700 rounded-md border border-indigo-200">
                        📐 A4 Landskap • Auto-Fit 1 Muka Surat ({Math.round(printScale * 100)}%)
                      </span>
                    </div>
                    <p className="hidden text-slate-500 text-xs mt-0.5">
                      Pratinjau visual berorientasikan A4 Landskap (297mm × 210mm) yang dilaraskan secara automatik untuk muat tepat pada satu halaman A4.
                    </p>
                  </div>
                  <button
                    onClick={printSchedule}
                    className="px-5 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 font-bold rounded-lg shadow-md shadow-indigo-100 flex items-center space-x-2 transition-all"
                  >
                    <span>🖨️ Muat Turun Jadual (PDF)</span>
                  </button>
                </div>

                {/* Document Outer Wrapper with A4 Landscape Page Frame (15 Classes per Page) */}
                {(() => {
                  const CLASSES_PER_PAGE = 15;
                  const classPages: DataRecord[][] = [];
                  for (let i = 0; i < schoolClasses.length; i += CLASSES_PER_PAGE) {
                    classPages.push(schoolClasses.slice(i, i + CLASSES_PER_PAGE));
                  }
                  if (classPages.length === 0) {
                    classPages.push([]);
                  }

                  return (
                    <div className="bg-slate-100 p-4 md:p-6 rounded-2xl border border-slate-200 max-w-full overflow-x-auto custom-scrollbar flex flex-col items-center gap-8">
                      {classPages.map((pageClasses, pageIndex) => (
                        <div
                          key={pageIndex}
                          ref={pageIndex === 0 ? printPreviewRef : undefined}
                          id={
                            pageIndex === 0
                              ? 'print-preview-container'
                              : `print-preview-container-${pageIndex + 1}`
                          }
                          style={{ width: '1122px', height: '778px' }}
                          className="bg-white p-[20px] rounded-md shadow-xl border border-slate-300 shrink-0 overflow-hidden box-border relative"
                        >
                          <div
                            ref={pageIndex === 0 ? printContentRef : undefined}
                            id={
                              pageIndex === 0
                                ? 'print-fit-content'
                                : `print-fit-content-${pageIndex + 1}`
                            }
                            className="print-fit-page flex flex-col justify-between box-border"
                            style={{ width: '1082px', minHeight: '738px' }}
                          >
                            <div>
                              {/* Printed School Letterhead Header */}
                              <div
                                id={
                                  pageIndex === 0
                                    ? 'print-letterhead'
                                    : `print-letterhead-${pageIndex + 1}`
                                }
                                className={`border-b-2 border-slate-900 text-center ${
                                  pageClasses.length > 10 ? 'pb-2 mb-2.5' : 'pb-3 mb-4'
                                }`}
                              >
                                <h4
                                  id={
                                    pageIndex === 0
                                      ? 'letterhead-school-name'
                                      : undefined
                                  }
                                  className={`${
                                    pageClasses.length > 12 ? 'text-base' : 'text-lg'
                                  } font-extrabold text-slate-900 tracking-wide uppercase leading-tight`}
                                >
                                  {currentUser?.username || '-'}
                                </h4>
                                <p
                                  id={
                                    pageIndex === 0
                                      ? 'letterhead-school-code'
                                      : undefined
                                  }
                                  className="text-xs font-bold text-indigo-600 mt-0.5 uppercase"
                                >
                                  Rumusan Pemetaan Jadual Waktu Mengikut Kelas
                                </p>
                                <div className="mt-1.5 text-slate-600 text-[10px] font-bold uppercase tracking-wider flex justify-center gap-3">
                                  <span id={pageIndex === 0 ? 'print-date' : undefined}>
                                    Tarikh Cetakan: {currentUser ? formattedPrintDate : '-'}
                                  </span>
                                  {classPages.length > 1 && (
                                    <span>
                                      • Muka Surat {pageIndex + 1} / {classPages.length}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Main Table (Max 15 Classes per Page) */}
                              <div
                                id={
                                  pageIndex === 0
                                    ? 'print-schedule-table'
                                    : `print-schedule-table-${pageIndex + 1}`
                                }
                                className="w-full"
                              >
                                {!currentUser ? null : pageClasses.length === 0 ||
                                  schoolSubjects.length === 0 ? (
                                  <p className="text-center py-6 text-slate-400">
                                    Tiada data asas untuk pratinjau cetakan.
                                  </p>
                                ) : (
                                  <table className="print-auto-table w-full border-collapse border-2 border-slate-900 leading-tight text-[10px]">
                                    <thead>
                                      <tr className="bg-slate-100 text-slate-900 border-b-2 border-slate-900">
                                        <th
                                          className={`border-r border-slate-900 text-center font-extrabold w-9 ${
                                            pageClasses.length > 11
                                              ? 'py-1 px-1'
                                              : 'py-1.5 px-1.5'
                                          }`}
                                        >
                                          BIL.
                                        </th>
                                        <th
                                          className={`border-r border-slate-900 font-extrabold text-left w-48 ${
                                            pageClasses.length > 11
                                              ? 'py-1 px-1.5'
                                              : 'py-1.5 px-2'
                                          }`}
                                        >
                                          KELAS
                                        </th>
                                        {schoolSubjects.map((subject) => (
                                          <th
                                            key={subject.id}
                                            className={`border-r border-slate-900 font-extrabold text-center uppercase ${
                                              pageClasses.length > 11
                                                ? 'py-1 px-1'
                                                : 'py-1.5 px-1.5'
                                            }`}
                                          >
                                            {subject.class_id || subject.name}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pageClasses.map((cls, index) => {
                                        const globalIndex =
                                          pageIndex * CLASSES_PER_PAGE + index;
                                        const cellPad =
                                          pageClasses.length > 12
                                            ? 'py-0.5 px-1'
                                            : pageClasses.length > 8
                                            ? 'py-1 px-1.5'
                                            : 'py-1.5 px-2';
                                        const classTeacherObj = cls.role
                                          ? schoolTeachers.find((t) => t.id === cls.role)
                                          : null;
                                        const classTeacherName =
                                          classTeacherObj?.name || 'Tiada Guru Kelas';
                                        const classTotalWaktu = schoolSubjects.reduce(
                                          (sum, subject) => {
                                            const assignment = schoolAssignments.find(
                                              (a) =>
                                                a.class_id === cls.id &&
                                                a.subject_id === subject.id
                                            );
                                            const assignedTeacher = assignment
                                              ? schoolTeachers.find(
                                                  (t) => t.id === assignment.teacher_id
                                                )
                                              : null;
                                            const assignedTeacher2 =
                                              assignment && assignment.role
                                                ? schoolTeachers.find(
                                                    (t) => t.id === assignment.role
                                                  )
                                                : null;
                                            const assignedTeacher3 =
                                              assignment && assignment.subject
                                                ? schoolTeachers.find(
                                                    (t) => t.id === assignment.subject
                                                  )
                                                : null;
                                            if (
                                              !assignedTeacher &&
                                              !assignedTeacher2 &&
                                              !assignedTeacher3
                                            )
                                              return sum;
                                            const timeVal = parseFloat(
                                              cls.level === 'Tahap 1'
                                                ? subject.role || '0'
                                                : cls.level === 'Tahap 3'
                                                ? subject.subject_id || '0'
                                                : subject.subject || '0'
                                            );
                                            return (
                                              sum +
                                              (Number.isFinite(timeVal) ? timeVal : 0)
                                            );
                                          },
                                          0
                                        );
                                        return (
                                          <tr
                                            key={cls.id}
                                            className="border-b border-slate-900"
                                          >
                                            <td
                                              className={`border-r border-slate-900 ${cellPad} text-center font-bold bg-slate-50`}
                                            >
                                              {globalIndex + 1}
                                            </td>
                                            <td
                                              className={`border-r border-slate-900 ${cellPad} bg-slate-50 uppercase whitespace-nowrap`}
                                            >
                                              <span className="font-extrabold text-slate-900 block leading-tight">
                                                {cls.name}{' '}
                                                <span className="normal-case text-[0.9em] font-bold text-slate-600">
                                                  | Jumlah Waktu : {classTotalWaktu}w
                                                </span>
                                              </span>
                                              <span className="text-[0.82em] font-bold text-indigo-600 block leading-tight mt-0.5">
                                                {classTeacherName}
                                              </span>
                                            </td>
                                            {schoolSubjects.map((subject) => {
                                              const assignment = schoolAssignments.find(
                                                (a) =>
                                                  a.class_id === cls.id &&
                                                  a.subject_id === subject.id
                                              );
                                              const assignedTeacher = assignment
                                                ? schoolTeachers.find(
                                                    (t) => t.id === assignment.teacher_id
                                                  )
                                                : null;
                                              const assignedTeacher2 =
                                                assignment && assignment.role
                                                  ? schoolTeachers.find(
                                                      (t) => t.id === assignment.role
                                                    )
                                                  : null;
                                              const assignedTeacher3 =
                                                assignment && assignment.subject
                                                  ? schoolTeachers.find(
                                                      (t) => t.id === assignment.subject
                                                    )
                                                  : null;
                                              const time =
                                                cls.level === 'Tahap 1'
                                                  ? subject.role || '0'
                                                  : cls.level === 'Tahap 3'
                                                  ? subject.subject_id || '0'
                                                  : subject.subject || '0';

                                              return (
                                                <td
                                                  key={subject.id}
                                                  className={`border-r border-slate-900 ${cellPad} text-center bg-white`}
                                                >
                                                  {assignedTeacher ||
                                                  assignedTeacher2 ||
                                                  assignedTeacher3 ? (
                                                    <>
                                                      {assignedTeacher && (
                                                        <span className="font-extrabold text-slate-900 block leading-tight">
                                                          {assignedTeacher.subject ||
                                                            assignedTeacher.name}
                                                        </span>
                                                      )}
                                                      {assignedTeacher2 && (
                                                        <span className="font-extrabold text-slate-900 block leading-tight">
                                                          +{' '}
                                                          {assignedTeacher2.subject ||
                                                            assignedTeacher2.name}
                                                        </span>
                                                      )}
                                                      {assignedTeacher3 && (
                                                        <span className="font-extrabold text-slate-900 block leading-tight">
                                                          +{' '}
                                                          {assignedTeacher3.subject ||
                                                            assignedTeacher3.name}
                                                        </span>
                                                      )}
                                                      <span className="text-[0.8em] text-slate-500 font-bold block leading-none mt-0.5">
                                                        {time} Wkt
                                                      </span>
                                                    </>
                                                  ) : (
                                                    <span className="text-slate-300 font-bold">
                                                      -
                                                    </span>
                                                  )}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>

                            {/* Signature Area only on the last page, pinned at the bottom of the page */}
                            {pageIndex === classPages.length - 1 && (
                              <div
                                className={`mt-auto grid grid-cols-2 gap-12 border-t border-slate-200 text-center ${
                                  pageClasses.length > 12 ? 'pt-2' : 'pt-3'
                                }`}
                              >
                                <div
                                  className={
                                    pageClasses.length > 12 ? 'space-y-6' : 'space-y-8'
                                  }
                                >
                                  <p className="text-[11px] font-bold uppercase text-slate-500">
                                    Disediakan Oleh,
                                  </p>
                                  <div>
                                    <div className="w-44 mx-auto border-b border-slate-400"></div>
                                    <p className="text-[11px] font-bold text-slate-700 mt-1 uppercase">
                                      Penolong Kanan Pentadbiran
                                    </p>
                                  </div>
                                </div>
                                <div
                                  className={
                                    pageClasses.length > 12 ? 'space-y-6' : 'space-y-8'
                                  }
                                >
                                  <p className="text-[11px] font-bold uppercase text-slate-500">
                                    Disahkan Oleh,
                                  </p>
                                  <div>
                                    <div className="w-44 mx-auto border-b border-slate-400"></div>
                                    <p className="text-[11px] font-bold text-slate-700 mt-1 uppercase">
                                      Guru Besar / Pengetua
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* SECTION 11: PEMETAAN GURU PDF (DUPLICATED FROM PEMETAAN KELAS PDF) */}
            {currentTab === 11 && (
              <div
                id="section-11"
                className="tab-content bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 md:p-8 fade-in"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-slate-900">Penjanaan Dokumen Cetak</h3>
                      <span className="hidden px-2.5 py-0.5 text-[11px] font-bold bg-indigo-50 text-indigo-700 rounded-md border border-indigo-200">
                        📐 A4 Landskap • Auto-Fit 1 Muka Surat ({Math.round(printScale * 100)}%)
                      </span>
                    </div>
                    <p className="hidden text-slate-500 text-xs mt-0.5">
                      Pratinjau visual berorientasikan A4 Landskap (297mm × 210mm) yang dilaraskan secara automatik untuk muat tepat pada satu halaman A4.
                    </p>
                  </div>
                  <button
                    onClick={printTeacherSchedule}
                    className="px-5 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 font-bold rounded-lg shadow-md shadow-indigo-100 flex items-center space-x-2 transition-all"
                  >
                    <span>🖨️ Muat Turun Jadual (PDF)</span>
                  </button>
                </div>

                {/* Document Outer Wrapper with A4 Landscape Page Frame (20 Teachers per Page) */}
                {(() => {
                  const TEACHERS_PER_PAGE = 20;
                  const teacherPages: DataRecord[][] = [];
                  for (let i = 0; i < schoolTeachers.length; i += TEACHERS_PER_PAGE) {
                    teacherPages.push(schoolTeachers.slice(i, i + TEACHERS_PER_PAGE));
                  }
                  if (teacherPages.length === 0) {
                    teacherPages.push([]);
                  }

                  const firstPageTeacherCount =
                    teacherPages[0]?.length || 0;

                  return (
                    <div className="bg-slate-100 p-4 md:p-6 rounded-2xl border border-slate-200 max-w-full overflow-x-auto custom-scrollbar flex flex-col items-center gap-8">
                      {teacherPages.map((pageTeachers, pageIndex) => (
                        <div
                          key={pageIndex}
                          ref={pageIndex === 0 ? printPreviewRef : undefined}
                          id={
                            pageIndex === 0
                              ? 'print-preview-container'
                              : `print-preview-container-${pageIndex + 1}`
                          }
                          style={{ width: '1122px', height: '778px' }}
                          className="bg-white p-[20px] rounded-md shadow-xl border border-slate-300 shrink-0 overflow-hidden box-border relative"
                        >
                          <div
                            ref={pageIndex === 0 ? printContentRef : undefined}
                            id={
                              pageIndex === 0
                                ? 'print-fit-content'
                                : `print-fit-content-${pageIndex + 1}`
                            }
                            className="print-fit-page flex flex-col justify-between box-border"
                            style={{ width: '1082px', minHeight: '738px' }}
                          >
                            <div>
                              {/* Printed School Letterhead Header */}
                              <div
                                id={
                                  pageIndex === 0
                                    ? 'print-letterhead'
                                    : `print-letterhead-${pageIndex + 1}`
                                }
                                className={`border-b-2 border-slate-900 text-center ${
                                  firstPageTeacherCount > 10 ? 'pb-2 mb-2.5' : 'pb-3 mb-4'
                                }`}
                              >
                                <h4
                                  id={
                                    pageIndex === 0
                                      ? 'letterhead-school-name'
                                      : undefined
                                  }
                                  className={`${
                                    firstPageTeacherCount > 12 ? 'text-base' : 'text-lg'
                                  } font-extrabold text-slate-900 tracking-wide uppercase leading-tight`}
                                >
                                  {currentUser?.username || '-'}
                                </h4>
                                <p
                                  id={
                                    pageIndex === 0
                                      ? 'letterhead-school-code'
                                      : undefined
                                  }
                                  className="text-xs font-bold text-indigo-600 mt-0.5 uppercase"
                                >
                                  Rumusan Pemetaan Jadual Waktu Mengikut Guru
                                </p>
                                <div className="mt-1.5 text-slate-600 text-[10px] font-bold uppercase tracking-wider flex justify-center gap-3">
                                  <span id={pageIndex === 0 ? 'print-date' : undefined}>
                                    Tarikh Cetakan: {currentUser ? formattedPrintDate : '-'}
                                  </span>
                                  {teacherPages.length > 1 && (
                                    <span>
                                      • Muka Surat {pageIndex + 1} / {teacherPages.length}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Main Table (Max 20 Teachers per Page) */}
                              <div
                                id={
                                  pageIndex === 0
                                    ? 'print-schedule-table'
                                    : `print-schedule-table-${pageIndex + 1}`
                                }
                                className="w-full"
                              >
                                {!currentUser ? null : pageTeachers.length === 0 ||
                                  schoolSubjects.length === 0 ? (
                                  <p className="text-center py-6 text-slate-400">
                                    Tiada data asas untuk pratinjau cetakan.
                                  </p>
                                ) : (
                                  <table className="print-auto-table w-full border-collapse border-2 border-slate-900 leading-tight text-[10px]">
                                    <thead>
                                      <tr className="bg-slate-100 text-slate-900 border-b-2 border-slate-900">
                                        <th
                                          className={`border-r border-slate-900 text-center font-extrabold w-9 ${
                                            firstPageTeacherCount > 12
                                              ? 'py-1 px-1'
                                              : 'py-1.5 px-1.5'
                                          }`}
                                        >
                                          BIL.
                                        </th>
                                        <th
                                          className={`border-r border-slate-900 font-extrabold text-left w-44 ${
                                            firstPageTeacherCount > 12
                                              ? 'py-1 px-1.5'
                                              : 'py-1.5 px-2'
                                          }`}
                                        >
                                          NAMA GURU
                                        </th>
                                        {schoolSubjects.map((subject) => (
                                          <th
                                            key={subject.id}
                                            className={`border-r border-slate-900 font-extrabold text-center uppercase ${
                                              firstPageTeacherCount > 12
                                                ? 'py-1 px-1'
                                                : 'py-1.5 px-1.5'
                                            }`}
                                          >
                                            {subject.class_id || subject.name}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pageTeachers.map((teacher, index) => {
                                        const globalIndex =
                                          pageIndex * TEACHERS_PER_PAGE + index;
                                        const cellPad =
                                          firstPageTeacherCount > 16
                                            ? 'py-0.5 px-1'
                                            : firstPageTeacherCount > 10
                                            ? 'py-1 px-1'
                                            : 'py-1.5 px-1.5';
                                        const teacherTotalWaktu = schoolAssignments
                                          .filter(
                                            (a) =>
                                              a.teacher_id === teacher.id ||
                                              a.role === teacher.id ||
                                              a.subject === teacher.id
                                          )
                                          .reduce((sum, a) => {
                                            const cls = schoolClasses.find(
                                              (c) => c.id === a.class_id
                                            );
                                            const subj = schoolSubjects.find(
                                              (s) => s.id === a.subject_id
                                            );
                                            if (!cls || !subj) return sum;
                                            const t =
                                              cls.level === 'Tahap 1'
                                                ? parseFloat(subj.role || '0')
                                                : cls.level === 'Tahap 3'
                                                ? parseFloat(subj.subject_id || '0')
                                                : parseFloat(subj.subject || '0');
                                            return sum + (Number.isFinite(t) ? t : 0);
                                          }, 0);
                                        return (
                                          <tr
                                            key={teacher.id}
                                            className="border-b border-slate-900"
                                          >
                                            <td
                                              className={`border-r border-slate-900 ${cellPad} text-center font-bold bg-slate-50`}
                                            >
                                              {globalIndex + 1}
                                            </td>
                                            <td
                                              className={`border-r border-slate-900 ${cellPad} bg-slate-50 uppercase whitespace-nowrap`}
                                            >
                                              <span className="text-[1.1em] font-extrabold text-slate-900 block leading-tight">
                                                {teacher.name}
                                              </span>
                                              <span className="normal-case text-[0.82em] font-bold text-indigo-600 block leading-tight mt-0.5">
                                                Jumlah Waktu : {teacherTotalWaktu}w
                                              </span>
                                            </td>
                                            {schoolSubjects.map((subject) => {
                                              const matchedAssignments =
                                                schoolAssignments.filter(
                                                  (a) =>
                                                    a.subject_id === subject.id &&
                                                    (a.teacher_id === teacher.id ||
                                                      a.role === teacher.id ||
                                                      a.subject === teacher.id)
                                                );
                                              const matchedClasses = matchedAssignments
                                                .map((a) =>
                                                  schoolClasses.find(
                                                    (c) => c.id === a.class_id
                                                  )
                                                )
                                                .filter((c): c is DataRecord => Boolean(c));

                                              const totalTime = matchedClasses.reduce(
                                                (sum, cls) => {
                                                  const t =
                                                    cls.level === 'Tahap 1'
                                                      ? parseFloat(subject.role || '0')
                                                      : cls.level === 'Tahap 3'
                                                      ? parseFloat(
                                                          subject.subject_id || '0'
                                                        )
                                                      : parseFloat(subject.subject || '0');
                                                  return sum + (Number.isFinite(t) ? t : 0);
                                                },
                                                0
                                              );

                                              const classLabels = matchedClasses.map(
                                                (c) => c.subject || c.name
                                              );
                                              const midIndex = Math.ceil(
                                                classLabels.length / 2
                                              );

                                              return (
                                                <td
                                                  key={subject.id}
                                                  className={`border-r border-slate-900 ${cellPad} text-center bg-white`}
                                                >
                                                  {matchedClasses.length > 0 ? (
                                                    <>
                                                      <span
                                                        className={`font-extrabold text-slate-900 block leading-tight whitespace-nowrap ${
                                                          classLabels.length > 2
                                                            ? 'text-[0.9em]'
                                                            : ''
                                                        }`}
                                                      >
                                                        {classLabels.length > 2 ? (
                                                          <>
                                                            <span className="block">
                                                              {classLabels
                                                                .slice(0, midIndex)
                                                                .join(', ')}
                                                            </span>
                                                            <span className="block">
                                                              {classLabels
                                                                .slice(midIndex)
                                                                .join(', ')}
                                                            </span>
                                                          </>
                                                        ) : (
                                                          classLabels.join(', ')
                                                        )}
                                                      </span>
                                                      <span className="text-[0.78em] text-slate-500 font-bold block leading-none mt-0.5">
                                                        {totalTime} Wkt
                                                      </span>
                                                    </>
                                                  ) : (
                                                    <span className="text-slate-300 font-bold">
                                                      -
                                                    </span>
                                                  )}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>

                            {/* Signature Area only on the last page, pinned at the bottom of the page */}
                            {pageIndex === teacherPages.length - 1 && (
                              <div
                                className={`mt-auto grid grid-cols-2 gap-12 border-t border-slate-200 text-center ${
                                  pageTeachers.length > 12 ? 'pt-2' : 'pt-3'
                                }`}
                              >
                                <div
                                  className={
                                    pageTeachers.length > 12 ? 'space-y-6' : 'space-y-8'
                                  }
                                >
                                  <p className="text-[11px] font-bold uppercase text-slate-500">
                                    Disediakan Oleh,
                                  </p>
                                  <div>
                                    <div className="w-44 mx-auto border-b border-slate-400"></div>
                                    <p className="text-[11px] font-bold text-slate-700 mt-1 uppercase">
                                      Penolong Kanan Pentadbiran
                                    </p>
                                  </div>
                                </div>
                                <div
                                  className={
                                    pageTeachers.length > 12 ? 'space-y-6' : 'space-y-8'
                                  }
                                >
                                  <p className="text-[11px] font-bold uppercase text-slate-500">
                                    Disahkan Oleh,
                                  </p>
                                  <div>
                                    <div className="w-44 mx-auto border-b border-slate-400"></div>
                                    <p className="text-[11px] font-bold text-slate-700 mt-1 uppercase">
                                      Guru Besar / Pengetua
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* CUSTOM MODAL OVERLAY (SAVES PREVENTING WINDOW ALERTS) */}
      {modal.isOpen && (
        <div
          id="custom-modal-overlay"
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full mx-4 overflow-hidden fade-in">
            <div className="p-6">
              <div className="flex items-center space-x-3 text-indigo-600 mb-4">
                <span id="modal-icon" className="text-3xl">
                  {modal.icon}
                </span>
                <h4 id="modal-title" className="text-lg font-bold text-slate-900">
                  {modal.title}
                </h4>
              </div>
              <p id="modal-message" className="text-sm text-slate-600 leading-relaxed">
                {modal.message}
              </p>

              {/* Input password field dynamically toggled */}
              {modal.showPasswordPrompt && (
                <div id="modal-input-wrapper" className="mt-4">
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                    {modal.passwordLabel || 'Kata Laluan Pentadbir'}
                  </label>
                  <input
                    ref={modalPasswordRef}
                    type="password"
                    id="modal-password-input"
                    value={modalPassword}
                    onChange={(e) => setModalPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleModalConfirm();
                    }}
                    placeholder="Masukkan kata laluan"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all"
                  />
                  {modalPasswordError && (
                    <p id="modal-error-text" className="text-rose-600 text-xs font-bold mt-2">
                      ❌ Kata laluan salah. Sila cuba lagi.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end space-x-3 border-t border-slate-100">
              <button
                id="modal-cancel-btn"
                onClick={() => setModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-xs font-bold transition-all"
              >
                Batal
              </button>
              <button
                id="modal-confirm-btn"
                onClick={handleModalConfirm}
                className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-xs font-bold transition-all"
              >
                {modal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Generation Spinner */}
      {isGeneratingPdf && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 text-center space-y-3 shadow-xl border max-w-xs mx-4">
            <span className="text-5xl block animate-bounce">⏳</span>
            <h4 className="font-bold text-slate-800">Menjana Dokumen Cetak...</h4>
            <p className="text-slate-500 text-xs">
              Sila tunggu seketika semasa format PDF dijana.
            </p>
          </div>
        </div>
      )}

      {/* Centered Animated Login & Sign Up Popup Window */}
      <AuthPopupModal
        isOpen={!currentUser && authPopupOpen}
        mode={authPopupMode}
        onModeChange={setAuthPopupMode}
        onClose={() => setAuthPopupOpen(false)}
        usersList={usersList}
        onLoginSubmit={handlePopupLogin}
        onSignUpSubmit={handlePopupSignUp}
        onInjectDemo={injectDemoData}
      />

      {/* Toast Notifications */}
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            opacity: toast.visible ? 1 : 0,
            transform: toast.visible ? 'translateY(0)' : 'translateY(8px)',
          }}
          className={`fixed top-6 right-6 px-5 py-3.5 rounded-xl text-white font-extrabold z-[60] text-xs shadow-xl flex items-center space-x-2 border transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-emerald-600 border-emerald-500'
              : 'bg-rose-600 border-rose-500'
          }`}
        >
          <span>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </>
  );
}
