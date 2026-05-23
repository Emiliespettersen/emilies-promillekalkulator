import React, { useState, useEffect, useRef } from 'react';
import { Camera, Plus, Trophy, LogOut, Sparkles, Clock, X, Check, Copy, Crown, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from './supabase';

// ============ Utilities ============

const generateId = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

const generateEventCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZÆØÅ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const resizeImage = (file, maxSize = 400) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = height * (maxSize / width); width = maxSize; }
      } else {
        if (height > maxSize) { width = width * (maxSize / height); height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
});

const calculateBAC = (drinks, user, now) => {
  if (!user || !drinks || drinks.length === 0) return 0;
  const r = user.gender === 'female' ? 0.55 : 0.68;
  let total = 0;
  drinks.forEach(d => {
    const alcoholGrams = d.volumeMl * (d.alcoholPercent / 100) * 0.789;
    const drinkBAC = alcoholGrams / (user.weight * r);
    const hoursSince = Math.max(0, (now - d.timestamp) / 3600000);
    total += Math.max(0, drinkBAC - 0.15 * hoursSince);
  });
  return total;
};

const getStatusFromBAC = (bac) => {
  if (bac < 0.1) return { label: 'Edru', color: '#94a3b8', emoji: '💧' };
  if (bac < 0.3) return { label: 'Lett brisen', color: '#a3e635', emoji: '🍻' };
  if (bac < 0.6) return { label: 'I siget', color: '#facc15', emoji: '😄' };
  if (bac < 1.0) return { label: 'Full', color: '#fb923c', emoji: '🥴' };
  if (bac < 1.8) return { label: 'Stupfull', color: '#ef4444', emoji: '😵' };
  return { label: 'Henta', color: '#dc2626', emoji: '⚠️' };
};

const formatBAC = (bac) => bac.toFixed(2).replace('.', ',');
const formatTime = (ts) => new Date(ts).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

const DRINK_PRESETS = [
  { name: 'Pils 0,33L', volumeMl: 330, alcoholPercent: 4.7, icon: '🍺' },
  { name: 'Pils 0,5L', volumeMl: 500, alcoholPercent: 4.7, icon: '🍺' },
  { name: 'Vin', volumeMl: 150, alcoholPercent: 13, icon: '🍷' },
  { name: 'Shot', volumeMl: 40, alcoholPercent: 40, icon: '🥃' },
  { name: 'Drink', volumeMl: 200, alcoholPercent: 10, icon: '🍹' },
  { name: 'Cider', volumeMl: 330, alcoholPercent: 4.5, icon: '🍏' },
];

// ============ Supabase data layer ============

const loadEventData = async (code) => {
  try {
    const [evRes, partsRes, drinksRes] = await Promise.all([
      supabase.from('events').select('*').eq('code', code).maybeSingle(),
      supabase.from('participants').select('*').eq('event_code', code),
      supabase.from('drinks').select('*').eq('event_code', code),
    ]);

    if (!evRes.data) return null;

    const participants = {};
    (partsRes.data || []).forEach(p => {
      participants[p.id] = {
        id: p.id,
        name: p.name,
        weight: Number(p.weight),
        gender: p.gender,
      };
    });

    const drinks = {};
    Object.keys(participants).forEach(pid => { drinks[pid] = []; });
    (drinksRes.data || []).forEach(d => {
      if (!drinks[d.user_id]) drinks[d.user_id] = [];
      drinks[d.user_id].push({
        id: d.id,
        photo: d.photo,
        alcoholPercent: Number(d.alcohol_percent),
        volumeMl: Number(d.volume_ml),
        timestamp: Number(d.timestamp_ms),
      });
    });

    return {
      event: {
        code: evRes.data.code,
        name: evRes.data.name,
        createdAt: new Date(evRes.data.created_at).getTime(),
        createdBy: evRes.data.created_by,
        participants,
      },
      drinks,
    };
  } catch (e) {
    console.error('loadEventData error:', e);
    return null;
  }
};

// ============ Main App ============

export default function PromilleApp() {
  const [screen, setScreen] = useState('loading');
  const [user, setUser] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [drinks, setDrinks] = useState({});
  const [showAddDrink, setShowAddDrink] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Tick clock for BAC decay
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Bootstrap: les lagret profil og last inn kvelden
  useEffect(() => {
    (async () => {
      const saved = localStorage.getItem('promillen_me');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.user && parsed.eventCode) {
            const data = await loadEventData(parsed.eventCode);
            if (data && data.event.participants[parsed.user.id]) {
              setUser(parsed.user);
              setEventData(data.event);
              setDrinks(data.drinks);
              setScreen('main');
              return;
            }
          }
        } catch (e) {}
      }
      setScreen('welcome');
    })();
  }, []);

  // Realtime: lytt på endringer i denne kvelden
  useEffect(() => {
    if (!eventData || screen !== 'main') return;
    const code = eventData.code;

    const refresh = async () => {
      const data = await loadEventData(code);
      if (data) {
        setEventData(data.event);
        setDrinks(data.drinks);
      }
    };

    const channel = supabase
      .channel(`event-${code}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `event_code=eq.${code}` },
        refresh)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'drinks', filter: `event_code=eq.${code}` },
        refresh)
      .subscribe();

    // Fallback: poll hvert 8. sekund i tilfelle realtime ikke trigger
    const pollId = setInterval(refresh, 8000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollId);
    };
  }, [eventData?.code, screen]);

  // Handlers
  const createEvent = async (eventName, profile) => {
    setError('');
    const code = generateEventCode();
    const userId = generateId();
    const fullUser = { ...profile, id: userId };

    const { error: eventError } = await supabase
      .from('events')
      .insert({ code, name: eventName || 'Kvelden', created_by: userId });
    if (eventError) { setError('Kunne ikke lage kveld: ' + eventError.message); return; }

    const { error: partError } = await supabase
      .from('participants')
      .insert({
        id: userId,
        event_code: code,
        name: profile.name,
        weight: profile.weight,
        gender: profile.gender,
      });
    if (partError) { setError('Kunne ikke legge til deltaker: ' + partError.message); return; }

    localStorage.setItem('promillen_me', JSON.stringify({ user: fullUser, eventCode: code }));
    const data = await loadEventData(code);
    if (data) {
      setUser(fullUser);
      setEventData(data.event);
      setDrinks(data.drinks);
      setScreen('main');
    }
  };

  const joinEvent = async (code, profile) => {
    setError('');
    const upperCode = code.trim().toUpperCase();
    const { data: ev } = await supabase.from('events').select('*').eq('code', upperCode).maybeSingle();
    if (!ev) { setError('Fant ingen kveld med den koden 🤷'); return; }

    const userId = generateId();
    const fullUser = { ...profile, id: userId };

    const { error: partError } = await supabase
      .from('participants')
      .insert({
        id: userId,
        event_code: upperCode,
        name: profile.name,
        weight: profile.weight,
        gender: profile.gender,
      });
    if (partError) { setError('Kunne ikke bli med: ' + partError.message); return; }

    localStorage.setItem('promillen_me', JSON.stringify({ user: fullUser, eventCode: upperCode }));
    const data = await loadEventData(upperCode);
    if (data) {
      setUser(fullUser);
      setEventData(data.event);
      setDrinks(data.drinks);
      setScreen('main');
    }
  };

  const addDrink = async (drink) => {
    if (!user || !eventData) return;
    const drinkId = generateId();
    const timestamp = Date.now();

    const { error } = await supabase.from('drinks').insert({
      id: drinkId,
      event_code: eventData.code,
      user_id: user.id,
      photo: drink.photo,
      alcohol_percent: drink.alcoholPercent,
      volume_ml: drink.volumeMl,
      timestamp_ms: timestamp,
    });

    if (error) {
      alert('Kunne ikke logge drikke: ' + error.message);
      return;
    }

    // Optimistisk oppdatering
    const newDrink = {
      id: drinkId,
      photo: drink.photo,
      alcoholPercent: drink.alcoholPercent,
      volumeMl: drink.volumeMl,
      timestamp,
    };
    setDrinks(d => ({
      ...d,
      [user.id]: [...(d[user.id] || []), newDrink],
    }));
    setShowAddDrink(false);
  };

  const leaveEvent = () => {
    if (!confirm('Forlat kvelden? Drikkene dine forblir på listen.')) return;
    localStorage.removeItem('promillen_me');
    setUser(null);
    setEventData(null);
    setDrinks({});
    setScreen('welcome');
  };

  const copyCode = () => {
    if (!eventData?.code) return;
    navigator.clipboard?.writeText(eventData.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const shareLink = () => {
    if (!eventData?.code) return;
    const url = `${window.location.origin}?kode=${eventData.code}`;
    const text = `Bli med på ${eventData.name} i Emilies Promillekalkulator! Kode: ${eventData.code}\n${url}`;
    if (navigator.share) {
      navigator.share({ title: eventData.name, text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    }
  };

  // Auto-fyll kveldskode hvis link inneholder ?kode=XYZ
  useEffect(() => {
    if (screen !== 'welcome') return;
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get('kode');
    if (codeFromUrl) {
      setScreen('join');
    }
  }, [screen]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .display-font { font-family: 'Anton', 'Impact', sans-serif; letter-spacing: 0.01em; }
        .body-font { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; }
        @keyframes pulse-glow {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .pulse-glow { animation: pulse-glow 2.5s ease-in-out infinite; }
        .slide-up { animation: slide-up 0.4s ease-out; }
        .glass {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
        }
        .glass-strong {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .grain {
          background-image:
            radial-gradient(circle at 20% 10%, rgba(212,255,0,0.07), transparent 40%),
            radial-gradient(circle at 80% 80%, rgba(255,45,146,0.08), transparent 40%);
        }
        input::placeholder { color: rgba(255,255,255,0.3); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="body-font min-h-screen w-full text-white relative overflow-hidden" style={{
        background: 'linear-gradient(180deg, #0a0814 0%, #14101e 50%, #0a0814 100%)',
        minHeight: '100vh',
      }}>
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="relative max-w-md mx-auto min-h-screen flex flex-col">
          {screen === 'loading' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-white/40">Laster...</div>
            </div>
          )}
          {screen === 'welcome' && (
            <WelcomeScreen
              onCreate={() => setScreen('create')}
              onJoin={() => setScreen('join')}
            />
          )}
          {screen === 'create' && (
            <CreateEventScreen
              onBack={() => { setScreen('welcome'); setError(''); }}
              onSubmit={createEvent}
              error={error}
            />
          )}
          {screen === 'join' && (
            <JoinEventScreen
              onBack={() => { setScreen('welcome'); setError(''); }}
              onSubmit={joinEvent}
              error={error}
              prefillCode={new URLSearchParams(window.location.search).get('kode') || ''}
            />
          )}
          {screen === 'main' && user && eventData && (
            <MainHub
              user={user}
              eventData={eventData}
              drinks={drinks}
              now={now}
              copied={copied}
              shareCopied={shareCopied}
              showHistory={showHistory}
              onToggleHistory={() => setShowHistory(s => !s)}
              onAddDrink={() => setShowAddDrink(true)}
              onCopyCode={copyCode}
              onShare={shareLink}
              onLeave={leaveEvent}
            />
          )}
        </div>
        {showAddDrink && (
          <AddDrinkModal
            onClose={() => setShowAddDrink(false)}
            onSubmit={addDrink}
          />
        )}
      </div>
    </>
  );
}

// ============ Welcome ============

function WelcomeScreen({ onCreate, onJoin }) {
  return (
    <div className="flex-1 flex flex-col px-6 py-12 slide-up">
      <div className="flex-1 flex flex-col justify-center items-center text-center">
        <div className="mb-3 text-5xl">🍻</div>
        <h1 className="display-font text-5xl mb-1 leading-none" style={{
          background: 'linear-gradient(135deg, #d4ff00 0%, #ff2d92 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          EMILIES
        </h1>
        <h2 className="display-font text-3xl mb-3" style={{
          background: 'linear-gradient(135deg, #ff2d92 0%, #d4ff00 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          PROMILLEKALKULATOR
        </h2>
        <p className="text-white/50 text-sm max-w-xs">
          Logg drikken dine, og se promillen stige
        </p>
      </div>
      <div className="space-y-3 pb-6">
        <button
          onClick={onCreate}
          className="w-full py-5 rounded-2xl font-bold text-lg transition-transform active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #d4ff00 0%, #a3e635 100%)',
            color: '#0a0814',
            boxShadow: '0 8px 32px rgba(212,255,0,0.25)',
          }}
        >
          Start en ny kveld
        </button>
        <button
          onClick={onJoin}
          className="w-full py-5 rounded-2xl font-semibold text-lg glass-strong transition-transform active:scale-95"
        >
          Bli med på en kveld
        </button>
      </div>
      <p className="text-center text-white/30 text-xs px-4">
        Have fun! Ikke gjør noe jeg ville gjort
      </p>
    </div>
  );
}

// ============ Create Event ============

function CreateEventScreen({ onBack, onSubmit, error }) {
  const [eventName, setEventName] = useState('');
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [gender, setGender] = useState('male');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim() && weight && Number(weight) > 30 && Number(weight) < 250 && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit(eventName, { name: name.trim(), weight: Number(weight), gender });
    setSubmitting(false);
  };

  return (
    <div className="flex-1 flex flex-col px-6 py-8 slide-up">
      <button onClick={onBack} className="text-white/60 text-sm mb-6 self-start hover:text-white">← Tilbake</button>
      <h2 className="display-font text-4xl mb-1">Start en kveld</h2>
      <p className="text-white/50 mb-8 text-sm">Gi kvelden et navn og fyll inn informasjonen din</p>

      <div className="space-y-4 flex-1">
        <Field label="Navn på kvelden">
          <input
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            placeholder="Sommerfest"
            className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
          />
        </Field>
        <Field label="Ditt navn">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Emilie"
            className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
          />
        </Field>
        <Field label="Vekt (kg)">
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={e => setWeight(e.target.value)}
            placeholder="65"
            className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
          />
        </Field>
        <Field label="Kjønn">
          <div className="grid grid-cols-2 gap-2">
            <GenderButton active={gender === 'male'} onClick={() => setGender('male')} label="Mann" />
            <GenderButton active={gender === 'female'} onClick={() => setGender('female')} label="Kvinne" />
          </div>
        </Field>
        {error && (
          <div className="text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <p className="text-white/30 text-xs">
          Vekt og kjønn brukes for å beregne promille
        </p>
      </div>

      <button
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full py-5 rounded-2xl font-bold text-lg mt-6 transition-all active:scale-95 disabled:opacity-30"
        style={{
          background: 'linear-gradient(135deg, #d4ff00 0%, #a3e635 100%)',
          color: '#0a0814',
          boxShadow: canSubmit ? '0 8px 32px rgba(212,255,0,0.25)' : 'none',
        }}
      >
        {submitting ? 'Starter...' : 'Start kvelden'}
      </button>
    </div>
  );
}

// ============ Join Event ============

function JoinEventScreen({ onBack, onSubmit, error, prefillCode }) {
  const [code, setCode] = useState(prefillCode);
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [gender, setGender] = useState('male');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = code.trim().length >= 4 && name.trim() && weight && Number(weight) > 30 && Number(weight) < 250 && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit(code, { name: name.trim(), weight: Number(weight), gender });
    setSubmitting(false);
  };

  return (
    <div className="flex-1 flex flex-col px-6 py-8 slide-up">
      <button onClick={onBack} className="text-white/60 text-sm mb-6 self-start hover:text-white">← Tilbake</button>
      <h2 className="display-font text-4xl mb-1">Bli med</h2>
      <p className="text-white/50 mb-8 text-sm">Bruk koden du fikk fra den som lagde kvelden</p>

      <div className="space-y-4 flex-1">
        <Field label="Kveldens kode">
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30 tracking-widest text-center text-2xl display-font"
          />
        </Field>
        {error && (
          <div className="text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <Field label="Ditt navn">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Kari"
            className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
          />
        </Field>
        <Field label="Vekt (kg)">
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={e => setWeight(e.target.value)}
            placeholder="65"
            className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
          />
        </Field>
        <Field label="Kjønn">
          <div className="grid grid-cols-2 gap-2">
            <GenderButton active={gender === 'male'} onClick={() => setGender('male')} label="Mann" />
            <GenderButton active={gender === 'female'} onClick={() => setGender('female')} label="Kvinne" />
          </div>
        </Field>
      </div>

      <button
        disabled={!canSubmit}
        onClick={handleSubmit}
        className="w-full py-5 rounded-2xl font-bold text-lg mt-6 transition-all active:scale-95 disabled:opacity-30"
        style={{
          background: 'linear-gradient(135deg, #ff2d92 0%, #c026d3 100%)',
          color: 'white',
          boxShadow: canSubmit ? '0 8px 32px rgba(255,45,146,0.3)' : 'none',
        }}
      >
        {submitting ? 'Blir med...' : 'Bli med'}
      </button>
    </div>
  );
}

// ============ Main Hub ============

function MainHub({ user, eventData, drinks, now, copied, shareCopied, showHistory, onToggleHistory, onAddDrink, onCopyCode, onShare, onLeave }) {
  const myDrinks = drinks[user.id] || [];
  const myBAC = calculateBAC(myDrinks, user, now);
  const status = getStatusFromBAC(myBAC);

  const scoreboardEntries = Object.values(eventData.participants || {})
    .map(p => {
      const userDrinks = drinks[p.id] || [];
      const bac = calculateBAC(userDrinks, p, now);
      return { ...p, bac, drinkCount: userDrinks.length, isMe: p.id === user.id };
    })
    .sort((a, b) => b.bac - a.bac);

  const allDrinks = Object.entries(drinks).flatMap(([uid, drinkList]) =>
    (drinkList || []).map(d => ({ ...d, userId: uid, userName: eventData.participants?.[uid]?.name || '?' }))
  ).sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="flex-1 flex flex-col px-5 py-6 pb-32">
      <div className="flex items-center justify-between mb-6">
        <div className="flex-1 min-w-0">
          <div className="text-white/40 text-xs uppercase tracking-wider">Kveld</div>
          <div className="text-lg font-bold truncate">{eventData.name}</div>
        </div>
        <button
          onClick={onCopyCode}
          className="glass px-3 py-2 rounded-xl flex items-center gap-2 text-sm font-mono hover:bg-white/10"
        >
          {copied ? <Check size={14} className="text-lime-300" /> : <Copy size={14} className="text-white/50" />}
          <span className="display-font tracking-widest">{eventData.code}</span>
        </button>
        <button onClick={onLeave} className="ml-2 p-2 text-white/40 hover:text-white">
          <LogOut size={18} />
        </button>
      </div>

      <button
        onClick={onShare}
        className="w-full py-3 rounded-xl glass-strong text-sm font-semibold mb-5 flex items-center justify-center gap-2 active:scale-95 transition"
      >
        {shareCopied ? <><Check size={16} className="text-lime-300" /> Lenken er kopiert!</> : <>📲 Del lenke med de andre</>}
      </button>

      <div className="glass-strong rounded-3xl p-6 mb-5 relative overflow-hidden">
        <div className="absolute inset-0 pulse-glow pointer-events-none" style={{
          background: `radial-gradient(circle at 50% 50%, ${status.color}33, transparent 60%)`,
        }} />
        <div className="relative">
          <div className="text-white/40 text-xs uppercase tracking-wider mb-1">Din promille</div>
          <div className="flex items-baseline gap-2 mb-3">
            <div className="display-font text-8xl leading-none" style={{ color: status.color }}>
              {formatBAC(myBAC)}
            </div>
            <div className="text-white/40 text-xl">‰</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{status.emoji}</span>
            <div className="px-3 py-1 rounded-full text-sm font-semibold" style={{
              background: `${status.color}22`,
              color: status.color,
            }}>
              {status.label}
            </div>
          </div>
          <div className="mt-4 text-white/40 text-xs flex items-center gap-1">
            <Clock size={11} /> {myDrinks.length} {myDrinks.length === 1 ? 'drikke' : 'drikker'} logget
          </div>
        </div>
      </div>

      <button
        onClick={onAddDrink}
        className="w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-transform active:scale-95 mb-6"
        style={{
          background: 'linear-gradient(135deg, #d4ff00 0%, #a3e635 100%)',
          color: '#0a0814',
          boxShadow: '0 8px 32px rgba(212,255,0,0.2)',
        }}
      >
        <Plus size={22} strokeWidth={3} />
        Logg drikke
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={16} className="text-yellow-400" />
          <h3 className="display-font text-2xl">TOPPLISTE</h3>
          <div className="ml-auto text-white/30 text-xs flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-lime-300 animate-pulse" />
            Live
          </div>
        </div>
        <div className="space-y-2">
          {scoreboardEntries.map((entry, idx) => (
            <ScoreRow key={entry.id} entry={entry} rank={idx + 1} />
          ))}
        </div>
      </div>

      <div>
        <button
          onClick={onToggleHistory}
          className="w-full flex items-center gap-2 mb-3 text-left"
        >
          <Sparkles size={16} className="text-pink-400" />
          <h3 className="display-font text-2xl">SISTE DRIKKER</h3>
          <span className="ml-auto text-white/30">
            {showHistory ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </span>
        </button>
        {showHistory && (
          <div className="space-y-2 slide-up">
            {allDrinks.length === 0 && (
              <div className="text-white/30 text-sm text-center py-6 glass rounded-2xl">
                Ingen drikker logget ennå
              </div>
            )}
            {allDrinks.slice(0, 30).map(drink => (
              <DrinkRow key={drink.id} drink={drink} />
            ))}
          </div>
        )}
      </div>

      <p className="text-white/20 text-xs text-center mt-8 px-4 leading-relaxed">
        Promillen er kun et estimat. Jeg er ingen proff
      </p>
    </div>
  );
}

function ScoreRow({ entry, rank }) {
  const status = getStatusFromBAC(entry.bac);
  const isTop = rank === 1 && entry.bac > 0.1;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-2xl ${entry.isMe ? 'glass-strong' : 'glass'} ${isTop ? 'ring-1 ring-yellow-400/30' : ''}`}>
      <div className="w-8 h-8 flex items-center justify-center font-bold text-sm" style={{
        color: rank === 1 ? '#facc15' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#d97706' : 'rgba(255,255,255,0.4)',
      }}>
        {isTop ? <Crown size={20} fill="#facc15" /> : `#${rank}`}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          {entry.name}
          {entry.isMe && <span className="text-xs text-lime-300 font-normal">deg</span>}
        </div>
        <div className="text-white/40 text-xs">
          {entry.drinkCount} {entry.drinkCount === 1 ? 'drikke' : 'drikker'} · {status.label}
        </div>
      </div>
      <div className="text-right">
        <div className="display-font text-3xl leading-none" style={{ color: status.color }}>
          {formatBAC(entry.bac)}
        </div>
        <div className="text-white/30 text-xs">‰</div>
      </div>
    </div>
  );
}

function DrinkRow({ drink }) {
  return (
    <div className="flex items-center gap-3 p-3 glass rounded-2xl">
      {drink.photo ? (
        <img src={drink.photo} alt="" className="w-12 h-12 rounded-lg object-cover" />
      ) : (
        <div className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl glass">🥃</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{drink.userName}</div>
        <div className="text-white/50 text-xs">
          {drink.volumeMl} ml · {String(drink.alcoholPercent).replace('.', ',')}%
        </div>
      </div>
      <div className="text-white/40 text-xs">{formatTime(drink.timestamp)}</div>
    </div>
  );
}

// ============ Add Drink Modal ============

function AddDrinkModal({ onClose, onSubmit }) {
  const [photo, setPhoto] = useState(null);
  const [alcoholPercent, setAlcoholPercent] = useState('');
  const [volumeMl, setVolumeMl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef(null);

  const canSubmit = alcoholPercent && volumeMl &&
    Number(String(alcoholPercent).replace(',', '.')) > 0 && Number(String(alcoholPercent).replace(',', '.')) <= 100 &&
    Number(volumeMl) > 0 && Number(volumeMl) < 5000 && !submitting;

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    const resized = await resizeImage(file, 400);
    setPhoto(resized);
    setProcessing(false);
  };

  const applyPreset = (preset) => {
    setVolumeMl(String(preset.volumeMl));
    setAlcoholPercent(String(preset.alcoholPercent));
  };

  const submit = async () => {
    setSubmitting(true);
    await onSubmit({
      photo,
      alcoholPercent: Number(String(alcoholPercent).replace(',', '.')),
      volumeMl: Number(volumeMl),
    });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center body-font" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md slide-up rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto no-scrollbar" style={{
        background: 'linear-gradient(180deg, #1a1428 0%, #14101e 100%)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="display-font text-3xl">NY DRIKKE</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1">
            <X size={22} />
          </button>
        </div>

        <div className="mb-5">
          <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Bilde</div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            className="hidden"
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={processing}
            className="w-full h-44 rounded-2xl glass flex items-center justify-center overflow-hidden relative"
          >
            {photo ? (
              <>
                <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <Camera size={32} />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center text-white/40">
                <Camera size={32} className="mb-2" />
                <span className="text-sm">{processing ? 'Behandler...' : 'Ta bilde'}</span>
              </div>
            )}
          </button>
        </div>

        <div className="mb-5">
          <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Hurtigvalg</div>
          <div className="grid grid-cols-3 gap-2">
            {DRINK_PRESETS.map(p => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="glass rounded-xl p-2 text-center hover:bg-white/10 active:scale-95 transition"
              >
                <div className="text-2xl mb-0.5">{p.icon}</div>
                <div className="text-[10px] text-white/70 leading-tight">{p.name}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <Field label="Mengde (ml)">
            <input
              type="number"
              inputMode="decimal"
              value={volumeMl}
              onChange={e => setVolumeMl(e.target.value)}
              placeholder="330"
              className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
            />
          </Field>
          <Field label="Alkohol %">
            <input
              type="text"
              inputMode="decimal"
              value={alcoholPercent}
              onChange={e => setAlcoholPercent(e.target.value)}
              placeholder="4,7"
              className="w-full px-4 py-3 rounded-xl glass text-white outline-none focus:border-white/30"
            />
          </Field>
        </div>

        <button
          disabled={!canSubmit}
          onClick={submit}
          className="w-full py-4 rounded-2xl font-bold text-lg transition-all active:scale-95 disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, #d4ff00 0%, #a3e635 100%)',
            color: '#0a0814',
            boxShadow: canSubmit ? '0 8px 32px rgba(212,255,0,0.25)' : 'none',
          }}
        >
          {submitting ? 'Lagrer...' : 'Logg drikken'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-white/40 text-xs uppercase tracking-wider mb-2">{label}</div>
      {children}
    </div>
  );
}

function GenderButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`py-3 rounded-xl font-semibold transition ${active ? 'text-black' : 'text-white/70 glass'}`}
      style={active ? {
        background: 'linear-gradient(135deg, #d4ff00 0%, #a3e635 100%)',
        boxShadow: '0 4px 20px rgba(212,255,0,0.2)',
      } : {}}
    >
      {label}
    </button>
  );
}