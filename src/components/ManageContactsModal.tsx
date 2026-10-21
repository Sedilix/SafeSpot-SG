/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { X, Plus, Trash2, UserPlus, Lock, BookUser, Star, Check } from 'lucide-react';
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
  // Must match the first <option> exactly (with the zero-width joiner), or the
  // select shows one emoji while the saved contact gets a broken pair.
  const [newEmoji, setNewEmoji] = useState('\u{1F469}‍\u{1F4BC}');
  const [addedNote, setAddedNote] = useState<string | null>(null);

  const lang = settings.language || 'en';

  useEscapeToClose(isOpen, onClose);

  // The modal stays mounted, so re-read the saved contacts each time it opens
  // (they may have loaded from the cloud after the first render).
  useEffect(() => {
    if (isOpen) {
      setList(ensureEmergency995(contacts));
      setImportNote(null);
      setAddedNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    setAddedNote(t('contacts.added', lang).replace('{name}', newName.trim()));
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
    <div
      id="modal-manage-contacts"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-contacts-title"
    >
      <div className="modal-panel max-w-xl">
        <div className="modal-head">
          <div className="flex min-w-0 items-center gap-3">
            <div className="icon-tile">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="modal-contacts-title" className="font-display text-2xl leading-none font-bold tracking-tight">
                {t('contacts.title', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('contacts.subtitle', lang)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink shrink-0 rounded-xl p-2 transition-colors"
            aria-label={t('common.close', lang)}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {/* Explainer Banner */}
          <div className="border-pine/30 bg-pine-soft text-pine-deep flex items-start gap-2.5 rounded-xl border p-4 text-sm">
            <Star className="fill-pine text-pine mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>
              <span className="font-bold">{t('contacts.preferredTitle', lang)}: </span>
              <span>{t('contacts.preferredDesc', lang)}</span>
            </p>
          </div>

          {/* Existing Contacts List */}
          <section aria-labelledby="contacts-current-heading" className="space-y-3">
            <h3 id="contacts-current-heading" className="font-body text-base font-bold">
              {t('contacts.current', lang).replace('{count}', String(list.length))}
            </h3>
            <ul className="space-y-2.5">
              {list.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${
                    c.isPrimary && !c.locked ? 'border-pine bg-pine-soft/40' : 'border-line bg-well/50'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="border-line bg-surface flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-2xl"
                      aria-hidden="true"
                    >
                      {c.emoji}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-ink text-base leading-tight font-bold break-words sm:text-lg">{c.name}</span>
                        {c.isPrimary && !c.locked && (
                          <span className="chip border-pine/60 bg-pine-soft text-pine-deep shrink-0 px-2 py-0.5 text-xs font-bold">
                            <Star className="fill-pine text-pine h-3 w-3" aria-hidden="true" />
                            {t('share.preferred', lang)}
                          </span>
                        )}
                      </div>
                      <div className="text-ink-soft mt-0.5 text-sm font-semibold">{c.phone}</div>
                    </div>
                  </div>

                  {c.locked ? (
                    <span
                      className="text-ink-soft flex shrink-0 items-center gap-1.5 px-2 text-sm font-bold"
                      title={t('contacts.lockedDesc', lang)}
                    >
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">{t('contacts.alwaysOn', lang)}</span>
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      {!c.isPrimary ? (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = setPreferredContact(list, c.id);
                            setList(updated);
                            onSaveContacts(updated);
                          }}
                          className="btn btn-sm btn-secondary"
                          aria-label={`${t('contacts.setPreferred', lang)}: ${c.name}`}
                        >
                          <Star className="h-4 w-4" aria-hidden="true" />
                          <span className="hidden sm:inline">{t('contacts.setPreferred', lang)}</span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="accessible-tap text-brick hover:bg-brick-soft hover:text-brick-deep rounded-xl transition-colors"
                        aria-label={`${t('contacts.delete', lang)}: ${c.name}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Import straight from the phone's address book where supported */}
          {(isContactPickerSupported() || importNote) && (
            <div className="space-y-3">
              {isContactPickerSupported() && (
                <button type="button" onClick={handleImportFromPhone} className="btn btn-md btn-secondary w-full">
                  <BookUser className="h-5 w-5" />
                  <span>{t('contacts.import', lang)}</span>
                </button>
              )}
              {importNote && (
                <p role="status" className="text-ink-soft text-sm font-semibold">
                  {importNote}
                </p>
              )}
            </div>
          )}

          {/* Add New Contact Form */}
          <section aria-labelledby="contacts-add-heading" className="border-line bg-well/60 rounded-xl border p-4 sm:p-5">
            <h3 id="contacts-add-heading" className="font-body mb-3 text-base font-bold">
              {t('contacts.addContact', lang)}
            </h3>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleAdd();
              }}
            >
              <div>
                <label className="label" htmlFor="contact-name">{t('contacts.name', lang)}</label>
                <input
                  id="contact-name"
                  type="text"
                  autoComplete="off"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. John, Dr. Smith"
                  className="input"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
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
                  <label className="label" htmlFor="contact-emoji">{t('contacts.iconLabel', lang)}</label>
                  <select
                    id="contact-emoji"
                    value={newEmoji}
                    onChange={(e) => setNewEmoji(e.target.value)}
                    className="input"
                  >
                    <option value={'\u{1F469}‍\u{1F4BC}'}>{'\u{1F469}‍\u{1F4BC}'} Daughter</option>
                    <option value={'\u{1F468}‍\u{1F4BC}'}>{'\u{1F468}‍\u{1F4BC}'} Son</option>
                    <option value={'\u{1FA7A}'}>{'\u{1FA7A}'} Caregiver / Nurse</option>
                    <option value={'❤️'}>{'❤️'} Spouse / Partner</option>
                    <option value={'\u{1F3E1}'}>{'\u{1F3E1}'} Neighbor</option>
                    <option value={'\u{1F697}'}>{'\u{1F697}'} Driver / Friend</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="contact-phone">{t('contacts.phone', lang)} (Singapore / International)</label>
                <input
                  id="contact-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+65 9123 4567 or 91234567"
                  className="input"
                />
              </div>

              <button
                type="submit"
                disabled={!newName.trim() || !newPhone.trim()}
                className="btn btn-lg btn-primary w-full"
              >
                <Plus className="h-5 w-5" />
                <span>{t('contacts.addContact', lang)}</span>
              </button>

              {addedNote && (
                <p role="status" className="text-pine-deep flex items-center gap-2 text-sm font-bold">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>{addedNote}</span>
                </p>
              )}
            </form>
          </section>
        </div>

        <div className="modal-foot justify-end">
          <button type="button" onClick={onClose} className="btn btn-md btn-primary">
            <Check className="h-5 w-5" />
            <span>{t('common.done', lang)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
