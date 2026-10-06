/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin,
  Building2,
  Hospital,
  Briefcase,
  Home,
  Loader2,
  X,
  Check,
  Search,
} from 'lucide-react';
import { AddressSuggestion, SavedPlaceKind } from '../types';

interface AddressAutocompleteInputProps {
  id?: string;
  value: string;
  onChange: (address: string, suggestion?: AddressSuggestion) => void;
  placeholder?: string;
  category?: SavedPlaceKind | 'general';
  label?: string;
  emoji?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  autoFocus?: boolean;
}

export const AddressAutocompleteInput: React.FC<AddressAutocompleteInputProps> = ({
  id,
  value,
  onChange,
  placeholder = 'Search address, building, or 6-digit postal code...',
  category = 'general',
  label,
  emoji,
  disabled = false,
  required = false,
  className = '',
  autoFocus = false,
}) => {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value updates
  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  const fetchSuggestions = useCallback(
    async (searchTerm: string) => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/places/autocomplete?q=${encodeURIComponent(searchTerm)}&category=${encodeURIComponent(category)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions);
            setIsOpen(data.suggestions.length > 0);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch address suggestions:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [category]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!val.trim()) {
      // If healthcare or work, show curated defaults on focus/empty
      if (category === 'healthcare' || category === 'work') {
        fetchSuggestions('');
      } else {
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
      try {
        const res = await fetch(`/api/places/resolve?placeId=${encodeURIComponent(s.id.slice('google-'.length))}`);
        if (res.ok) {
          const r = await res.json();
          chosen = { ...s, lat: r.lat, lng: r.lng, postalCode: r.postalCode ?? s.postalCode, fullAddress: r.fullAddress || s.fullAddress };
        }
      } catch {
        // keep the unresolved suggestion; it can still be geocoded later
      }
    }
    const chosenAddress = chosen.fullAddress || chosen.title;
    setQuery(chosenAddress);
    setIsOpen(false);
    setSelectedIndex(-1);
    onChange(chosenAddress, chosen);
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setIsOpen(false);
    onChange('');
    inputRef.current?.focus();
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
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
      setIsOpen(false);
    }
  };

  // Icon for category
  const renderCategoryIcon = () => {
    if (category === 'home') return <Home className="h-5 w-5 text-pine" />;
    if (category === 'work') return <Briefcase className="h-5 w-5 text-sky" />;
    if (category === 'healthcare') return <Hospital className="h-5 w-5 text-brick" />;
    return <MapPin className="h-5 w-5 text-pine" />;
  };

  // Icon for individual suggestion
  const getSuggestionIcon = (s: AddressSuggestion) => {
    if (s.category === 'healthcare' || s.title.toLowerCase().includes('hospital') || s.title.toLowerCase().includes('polyclinic')) {
      return <Hospital className="h-5 w-5 text-brick shrink-0 mt-0.5" />;
    }
    if (s.category === 'work' || s.title.toLowerCase().includes('block71') || s.title.toLowerCase().includes('tower')) {
      return <Building2 className="h-5 w-5 text-sky shrink-0 mt-0.5" />;
    }
    if (s.category === 'home' || s.title.toLowerCase().startsWith('blk')) {
      return <Home className="h-5 w-5 text-pine shrink-0 mt-0.5" />;
    }
    return <MapPin className="h-5 w-5 text-ink-soft shrink-0 mt-0.5" />;
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {label && (
        <label className="label flex items-center justify-between" htmlFor={id}>
          <span>
            {emoji && <span className="mr-1.5" aria-hidden="true">{emoji}</span>}
            {label}
            {required && <span className="text-brick ml-1">*</span>}
          </span>
          <span className="text-xs font-normal text-ink-faint">Google & OneMap Verified</span>
        </label>
      )}

      <div className="relative">
        <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-pine" />
          ) : (
            renderCategoryIcon()
          )}
        </div>

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className="input pl-11 pr-10 text-base font-semibold"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          role="combobox"
        />

        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="text-ink-faint hover:text-ink hover:bg-well absolute inset-y-0 right-0 flex items-center pr-3 my-1.5 mr-1.5 rounded-lg transition-colors"
            title="Clear address"
            aria-label="Clear address input"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown Popover */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint flex items-center justify-between border-b border-line/60 mb-1">
            <span>Suggestions for {category === 'healthcare' ? 'Hospitals & Polyclinics' : category === 'work' ? 'Offices & Business Hubs' : 'Singapore Addresses'}</span>
            <span className="text-pine font-bold">Tap to fill</span>
          </div>

          <div className="space-y-0.5">
            {suggestions.map((s, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={s.id || `${s.title}-${idx}`}
                  type="button"
                  onClick={() => handleSelect(s)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left flex items-start gap-3 rounded-xl p-2.5 transition-all ${
                    isSelected
                      ? 'bg-pine-soft text-pine-deep font-semibold shadow-xs'
                      : 'hover:bg-well/80 text-ink'
                  }`}
                >
                  {getSuggestionIcon(s)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm sm:text-base font-bold">
                        {s.title}
                      </span>
                      {s.postalCode && (
                        <span className="shrink-0 chip bg-well text-ink-soft text-[10px] px-1.5 py-0.5 font-mono font-bold">
                          S{s.postalCode}
                        </span>
                      )}
                    </div>
                    {s.subtitle && (
                      <p className="text-xs text-ink-soft truncate mt-0.5">
                        {s.subtitle}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 text-pine shrink-0 self-center" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
