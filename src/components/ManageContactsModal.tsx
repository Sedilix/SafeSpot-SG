/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Plus, Trash2, UserPlus, Lock, BookUser, Star } from 'lucide-react';
import { EmergencyContact, AccessibilitySettings } from '../types';
import { ensureEmergency995 } from '../data/defaultContacts';
import { importContactsFromPhone, isContactPickerSupported, setPreferredContact, normalisePhone } from '../utils/contacts';
import { t } from '../locales/translations';
import { useEscapeToClose } from '../utils/useEscapeToClose';

interface ManageContactsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: EmergencyContact[];
  onSaveContacts: (contacts: EmergencyContact[]) => void;
  settings: AccessibilitySettings;
}

export const ManageContactsModal: React.FC<ManageContactsModalProps> = ({
  isOpen,
  onClose,
  contacts,
  onSaveContacts,
  settings,
}) => {
  const [list, setList] = useState<EmergencyContact[]>(() => ensureEmergency995(contacts));
  const [importNote, setImportNote] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newRelationship, setNewRelationship] = useState('Daughter');
  const [newPhone, setNewPhone] = useState('');
  const [newEmoji, setNewEmoji] = useState('👩💼');

  const lang = settings.language || 'en';

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (!newName.trim() || !newPhone.trim()) return;

    const nonEmergencyCount = list.filter((c) => !c.locked).length;
    const newContact: EmergencyContact = {
      id: `contact-${Date.now()}`,
      name: `${newName.trim()} (${newRelationship})`,
      relationship: newRelationship,
      phone: normalisePhone(newPhone.trim()),
      emoji: newEmoji,
      bgColor: 'bg-emerald-600 hover:bg-emerald-700 text-white',
      isPrimary: nonEmergencyCount === 0,
    };

    const updated = [...list, newContact];
    setList(updated);
    onSaveContacts(updated);
    setNewName('');
    setNewPhone('');
  };

  const handleDelete = (id: string) => {
    // ensureEmergency995 re-seats the locked SCDF entry even if something else
    // removed it; the delete button is not rendered for locked contacts.
    const remaining = list.filter((c) => c.id !== id);
    // If the deleted contact was primary, designate the first remaining non-locked contact as primary
    let updated = ensureEmergency995(remaining);
    if (!updated.some((c) => c.isPrimary && !c.locked)) {
      const firstFamily = updated.find((c) => !c.locked);
      if (firstFamily) {
        updated = setPreferredContact(updated, firstFamily.id);
      }
    }
    setList(updated);
    onSaveContacts(updated);
  };

  const handleImportFromPhone = async () => {
    const result = await importContactsFromPhone(list);
    if (result.error) {
      setImportNote(result.error);
      return;
    }
    if (result.imported.length === 0) {
      setImportNote(
        result.duplicates > 0 ? 'Those contacts are already saved.' : 'No contacts were chosen.'
      );
      return;
    }
    const updated = ensureEmergency995([...list, ...result.imported]);
    setList(updated);
    onSaveContacts(updated);
    setImportNote(
      `Added ${result.imported.length} contact${result.imported.length === 1 ? '' : 's'}` +
        (result.duplicates > 0 ? `, skipped ${result.duplicates} already saved.` : '.')
    );
  };

  return (
    <div id="modal-manage-contacts" className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel max-w-xl overflow-y-auto p-6 sm:p-8">
        <div className="border-line mb-5 flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="icon-tile">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-2xl leading-none font-bold tracking-tight">
                {t('contacts.title', lang)}
              </h3>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('contacts.subtitle', lang)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink rounded-xl p-2 transition-colors"
            aria-label="Close contacts manager"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Explainer Banner */}
        <div className="rounded-xl border border-pine/30 bg-pine-soft p-3.5 text-pine-deep flex items-start gap-2.5 text-xs sm:text-sm mb-4">
          <Star className="h-5 w-5 shrink-0 fill-pine text-pine mt-0.5" />
          <div>
            <span className="font-bold">⭐ Preferred Pick-Up Person: </span>
            <span>The person marked as <strong>Preferred</strong> will automatically receive your live Google Maps pin and pickup instructions whenever you tap "Pick Me Up Here".</span>
          </div>
        </div>

        {/* Existing Contacts List */}
        <div className="mb-6 space-y-2.5">
          <div className="section-kicker mb-2 text-sm">Current Contacts ({list.length})</div>
          {list.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-all ${
                c.isPrimary && !c.locked ? 'border-pine bg-pine-soft/40 shadow-sm' : 'border-line bg-well/50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="border-line bg-surface rounded-lg border p-1.5 text-2xl shrink-0">{c.emoji}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-ink text-base leading-tight font-bold sm:text-lg truncate">{c.name}</span>
                    {c.isPrimary && !c.locked && (
                      <span className="chip border-pine/60 bg-pine-soft text-pine-deep text-xs font-bold py-0.5 px-2 shrink-0">
                        <Star className="h-3 w-3 fill-pine text-pine" />
                        {t('share.preferred', lang)}
                      </span>
                    )}
                  </div>
                  <div className="text-ink-soft mt-0.5 text-sm font-semibold">{c.phone}</div>
                </div>
              </div>

              {c.locked ? (
                <span
                  className="text-ink-faint flex items-center gap-1.5 px-2 text-xs font-bold shrink-0"
                  title="Singapore SCDF emergency line — always available and cannot be removed"
                >
                  <Lock className="h-4 w-4" />
                  <span className="hidden sm:inline">Always on</span>
                </span>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  {!c.isPrimary ? (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = setPreferredContact(list, c.id);
                        setList(updated);
                        onSaveContacts(updated);
                      }}
                      className="text-xs font-bold text-ink-soft hover:text-pine hover:bg-pine-soft/50 border border-line rounded-lg px-2.5 py-1.5 flex items-center gap-1 transition-colors"
                      title="Set as Preferred Pick-Up Contact"
                    >
                      <Star className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Set Preferred</span>
                    </button>
                  ) : null}

                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-brick hover:bg-brick-soft rounded-lg p-2.5 transition-colors"
                    title="Remove Contact"
                    aria-label={`Remove ${c.name}`}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Import straight from the phone's address book where supported */}
        {isContactPickerSupported() && (
          <button onClick={handleImportFromPhone} className="btn btn-md btn-secondary mb-3 w-full">
            <BookUser className="h-5 w-5" />
            {t('contacts.import', lang)}
          </button>
        )}
        {importNote && <p className="text-ink-soft mb-3 text-sm font-semibold">{importNote}</p>}

        {/* Add New Contact Form */}
        <div className="border-line bg-well/60 mb-6 rounded-xl border p-4 sm:p-5">
          <div className="section-kicker mb-3 text-sm">{t('contacts.addContact', lang)}</div>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="contact-name">{t('contacts.name', lang)}</label>
              <input
                id="contact-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. John, Dr. Smith"
                className="input"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="contact-relationship">{t('contacts.relationship', lang)}</label>
                <select
                  id="contact-relationship"
                  value={newRelationship}
                  onChange={(e) => setNewRelationship(e.target.value)}
                  className="input"
                >
                  <option value="Daughter">Daughter</option>
                  <option value="Son">Son</option>
                  <option value="Caregiver">Caregiver</option>
                  <option value="Spouse">Spouse</option>
                  <option value="Neighbor">Neighbor</option>
                  <option value="Doctor">Doctor</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="label" htmlFor="contact-emoji">Emoji Icon</label>
                <select
                  id="contact-emoji"
                  value={newEmoji}
                  onChange={(e) => setNewEmoji(e.target.value)}
                  className="input"
                >
                  <option value="👩‍💼">👩‍💼 Daughter</option>
                  <option value="👨‍💼">👨‍💼 Son</option>
                  <option value="🩺">🩺 Caregiver / Nurse</option>
                  <option value="❤️">❤️ Spouse / Partner</option>
                  <option value="🏡">{'\u{1F3E1}'} Neighbor</option>
                  <option value="🚗">{'\u{1F697}'} Driver / Friend</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="contact-phone">{t('contacts.phone', lang)} (Singapore / International)</label>
              <input
                id="contact-phone"
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+65 9123 4567 or 91234567"
                className="input"
              />
            </div>

            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newPhone.trim()}
              className="btn btn-lg btn-primary w-full"
            >
              <Plus className="h-5 w-5" />
              <span>{t('contacts.addContact', lang)}</span>
            </button>
          </div>
        </div>

        <button onClick={onClose} className="btn btn-lg btn-secondary w-full">
          {t('common.done', lang)}
        </button>
      </div>
    </div>
  );
};
