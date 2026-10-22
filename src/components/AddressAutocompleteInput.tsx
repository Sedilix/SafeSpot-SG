/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  MapPin,
  Building2,
  Hospital,
  Briefcase,
  Home,
  Loader2,
  X,
  Check,
} from 'lucide-react';
import { AddressSuggestion, Language, SavedPlaceKind } from '../types';
import { t } from '../locales/translations';

interface AddressAutocompleteInputProps {
  id?: string;
  value: string;
  onChange: (address: string, suggestion?: AddressSuggestion) => void;
  placeholder?: string;
  category?: SavedPlaceKind | 'general';
  label?: string;
  /** Kept for API compatibility; the category icon inside the field now marks the place type. */
  emoji?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  autoFocus?: boolean;
  /** UI language for the field's own helper text. */
  lang?: Language;
}

export const AddressAutocompleteInput: React.FC<AddressAutocompleteInputProps> = ({
  id,
  value,
  onChange,
  placeholder,
  category = 'general',
  label,
  disabled = false,
  required = false,
  className = '',
  autoFocus = false,
  lang: langProp,
}) => {
  const lang: Language = langProp ?? 'en';
  const autoId = useId();
  const inputId = id || `address-${autoId}`;
  const listboxId = `${inputId}-listbox`;
  const hintId = `${inputId}-hint`;

  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  // Feedback when a search finds nothing or the search service is down, so a
  // closed dropdown is never mistaken for "still searching".
  const [searchHint, setSearchHint] = useState<'none' | 'error' | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // Where the dropdown sits on screen. It's rendered into <body> so a
  // scrolling dialog (ProfileModal, onboarding) can't clip it.
  const [dropdownPos, setDropdownPos] = useState<React.CSSProperties | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest request may update the list; slower, older replies are dropped.
  const requestSeqRef = useRef(0);

  // Sync external value updates
  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    },
    []
  );

  const fetchSuggestions = useCallback(
    async (searchTerm: string) => {
      const seq = ++requestSeqRef.current;
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/places/autocomplete?q=${encodeURIComponent(searchTerm)}&category=${encodeURIComponent(category)}`
        );
        if (seq !== requestSeqRef.current) return;
        if (!res.ok) {
          setSearchHint(searchTerm.trim() ? 'error' : null);
          return;
        }
        const data = await res.json();
        if (seq !== requestSeqRef.current) return;
        if (Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions);
          setIsOpen(data.suggestions.length > 0);
          setSelectedIndex(-1);
          setSearchHint(data.suggestions.length === 0 && searchTerm.trim().length >= 3 ? 'none' : null);
        }
      } catch (err) {
        console.warn('Failed to fetch address suggestions:', err);
        if (seq === requestSeqRef.current) setSearchHint(searchTerm.trim() ? 'error' : null);
      } finally {
        if (seq === requestSeqRef.current) setIsLoading(false);
      }
    },
    [category]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    setSearchHint(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!val.trim()) {
      // If healthcare or work, show curated defaults on focus/empty
      if (category === 'healthcare' || category === 'work') {
        fetchSuggestions('');
      } else {
        requestSeqRef.current++;
        setIsLoading(false);
        setSuggestions([]);
        setIsOpen(false);
      }
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(val);
    }, 180);
  };

  const handleFocus = () => {
    if (category === 'healthcare' || category === 'work' || query.length >= 2) {
      fetchSuggestions(query);
    }
  };

  const handleSelect = async (s: AddressSuggestion) => {
    let chosen = s;
    // Google suggestions have no coordinates; look them up (and confirm the
    // official address via OneMap) so a saved place is always usable.
    if (s.source === 'google' && (s.lat == null || s.lng == null) && s.id?.startsWith('google-')) {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/places/resolve?placeId=${encodeURIComponent(s.id.slice('google-'.length))}`);
        if (res.ok) {
          const r = await res.json();
          chosen = { ...s, lat: r.lat, lng: r.lng, postalCode: r.postalCode ?? s.postalCode, fullAddress: r.fullAddress || s.fullAddress };
        }
      } catch {
        // keep the unresolved suggestion; it can still be geocoded later
      } finally {
        setIsLoading(false);
      }
    }
    const chosenAddress = chosen.fullAddress || chosen.title;
    setQuery(chosenAddress);
    setIsOpen(false);
    setSelectedIndex(-1);
    setSearchHint(null);
    onChange(chosenAddress, chosen);
  };

  const handleClear = () => {
    requestSeqRef.current++;
    setIsLoading(false);
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    setSearchHint(null);
    onChange('');
    inputRef.current?.focus();
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      // Close the list without also closing a dialog this field sits in.
      e.stopPropagation();
      setIsOpen(false);
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  // Icon for category
  const renderCategoryIcon = () => {
    if (category === 'home') return <Home className="h-5 w-5 text-ink-soft" aria-hidden="true" />;
    if (category === 'work') return <Briefcase className="h-5 w-5 text-ink-soft" aria-hidden="true" />;
    if (category === 'healthcare') return <Hospital className="h-5 w-5 text-ink-soft" aria-hidden="true" />;
    return <MapPin className="h-5 w-5 text-ink-soft" aria-hidden="true" />;
  };

  // Icon for individual suggestion
  const getSuggestionIcon = (s: AddressSuggestion) => {
    const cls = 'h-5 w-5 shrink-0 mt-0.5';
    if (s.category === 'healthcare' || s.title.toLowerCase().includes('hospital') || s.title.toLowerCase().includes('polyclinic')) {
      return <Hospital className={cls} aria-hidden="true" />;
    }
    if (s.category === 'work' || s.title.toLowerCase().includes('block71') || s.title.toLowerCase().includes('tower')) {
      return <Building2 className={cls} aria-hidden="true" />;
    }
    if (s.category === 'home' || s.title.toLowerCase().startsWith('blk')) {
      return <Home className={cls} aria-hidden="true" />;
    }
    return <MapPin className={cls} aria-hidden="true" />;
  };

  const listHeading =
    category === 'healthcare'
      ? t('address.suggestHealthcare', lang)
      : category === 'work'
      ? t('address.suggestWork', lang)
      : t('address.suggestGeneral', lang);

  const showList = isOpen && suggestions.length > 0;
  const activeOptionId = showList && selectedIndex >= 0 ? `${listboxId}-opt-${selectedIndex}` : undefined;

  // Pin the dropdown to the input, opening upward when there isn't room
  // below, and follow it while any ancestor scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!showList) {
      setDropdownPos(null);
      return;
    }
    const place = () => {
      const input = inputRef.current;
      if (!input) return;
      const r = input.getBoundingClientRect();
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom - gap - 8;
      const spaceAbove = r.top - gap - 8;
      const above = spaceBelow < 240 && spaceAbove > spaceBelow;
      setDropdownPos({
        left: r.left,
        width: r.width,
        maxHeight: Math.min(360, above ? spaceAbove : spaceBelow),
        ...(above ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [showList]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {label && (
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <label className="label mb-0" htmlFor={inputId}>
            {label}
            {required && (
              <span className="text-brick ml-1" aria-hidden="true">
                *
              </span>
            )}
          </label>
          <span className="text-ink-soft text-xs">{t('address.sources', lang)}</span>
        </div>
      )}

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-pine" aria-hidden="true" />
          ) : (
            renderCategoryIcon()
          )}
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t('address.placeholder', lang)}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          autoComplete="off"
          className="input pl-11 pr-12 text-base font-semibold"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-busy={isLoading || undefined}
          aria-describedby={searchHint ? hintId : undefined}
        />

        {query && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="text-ink-soft hover:text-ink hover:bg-well absolute top-1/2 right-0.5 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-pine"
            aria-label={t('address.clear', lang)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {searchHint && !showList && (
        <p id={hintId} role="status" className="text-ink-soft mt-1.5 text-sm">
          {t(searchHint === 'none' ? 'address.noMatches' : 'address.searchError', lang)}
        </p>
      )}

      {/* Autocomplete dropdown */}
      {showList && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownPos}
          className="border-line bg-surface animate-fade-in fixed z-[60] flex flex-col overflow-hidden rounded-2xl border shadow-lg"
        >
          <div className="border-line text-ink-soft flex shrink-0 items-center justify-between gap-3 border-b px-3.5 py-2 text-xs font-bold">
            <span className="truncate">{listHeading}</span>
            <span className="text-pine-deep shrink-0">{t('address.tapToFill', lang)}</span>
          </div>

          <div id={listboxId} role="listbox" aria-label={listHeading} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-1.5">
            {suggestions.map((s, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={s.id || `${s.title}-${idx}`}
                  id={`${listboxId}-opt-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  onClick={() => handleSelect(s)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex min-h-12 w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors ${
                    isSelected ? 'bg-pine-soft text-pine-deep' : 'text-ink hover:bg-well'
                  }`}
                >
                  <span className={isSelected ? 'text-pine-deep' : 'text-ink-soft'}>{getSuggestionIcon(s)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold sm:text-base">{s.title}</span>
                      {s.postalCode && (
                        <span className="chip border-line bg-well text-ink-soft shrink-0 px-2 py-0.5 tabular-nums">
                          S{s.postalCode}
                        </span>
                      )}
                    </div>
                    {s.subtitle && <p className="text-ink-soft mt-0.5 truncate text-sm">{s.subtitle}</p>}
                  </div>
                  {isSelected && <Check className="text-pine h-4 w-4 shrink-0 self-center" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
