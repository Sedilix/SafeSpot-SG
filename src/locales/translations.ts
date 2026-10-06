/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Central localization dictionary for Senior SafeSpot Singapore.
 * Covers Singapore's 4 official languages: English, Mandarin Chinese (简体中文),
 * Bahasa Melayu, and Tamil (தமிழ்), with Singlish-friendly English phrasing.
 */

import { Language } from '../types';

export interface LanguageOption {
  id: Language;
  nativeName: string;
  englishName: string;
  flag: string;
  /** BCP-47 locale used for Web Speech synthesis of non-English readouts */
  speechLocale: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: 'en', nativeName: 'English', englishName: 'English', flag: '🇸🇬', speechLocale: 'en-SG' },
  { id: 'zh', nativeName: '中文', englishName: 'Mandarin', flag: '🇸🇬', speechLocale: 'zh-CN' },
  { id: 'ms', nativeName: 'Melayu', englishName: 'Malay', flag: '🇸🇬', speechLocale: 'ms-MY' },
  { id: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', flag: '🇸🇬', speechLocale: 'ta-IN' },
];

/**
 * Translation keys grouped by UI surface. Every key must have an `en` value;
 * missing keys in other languages fall back to English via `t()`.
 */
export const TRANSLATIONS: Record<string, Partial<Record<Language, string>>> = {
  // ── Header / Accessibility bar ──────────────────────────────────────────
  'header.tagline': {
    en: 'Verified GPS • Google Street View AI • 1-Tap SG Family Alerts',
    zh: '已验证的GPS定位 • 街景AI比对 • 一键通知家人',
    ms: 'GPS Disahkan • AI Street View • Amaran Keluarga 1-Tap',
    ta: 'சரிபார்க்கப்பட்ட GPS • ஸ்ட்ரீட் வியூ AI • ஒரே தட்டலில் குடும்ப எச்சரிக்கை',
  },
  'header.voiceAssistant': {
    en: 'Voice Assistant',
    zh: '语音助手',
    ms: 'Pembantu Suara',
    ta: 'குரல் உதவியாளர்',
  },
  'header.voiceOn': {
    en: 'Voice On',
    zh: '语音开启',
    ms: 'Suara Hidup',
    ta: 'குரல் இயக்கம்',
  },
  'header.voiceOff': {
    en: 'Voice Off',
    zh: '语音关闭',
    ms: 'Suara Mati',
    ta: 'குரல் அணைப்பு',
  },
  'header.settings': {
    en: 'Settings',
    zh: '设置',
    ms: 'Tetapan',
    ta: 'அமைப்புகள்',
  },
  'header.contrast': {
    en: 'Contrast',
    zh: '高对比',
    ms: 'Kontras',
    ta: 'மாறுபாடு',
  },
  'header.signIn': {
    en: 'Sign In',
    zh: '登录',
    ms: 'Log Masuk',
    ta: 'உள்நுழைய',
  },
  'header.sos': {
    en: 'SOS 995',
    zh: '紧急 995',
    ms: 'SOS 995',
    ta: 'SOS 995',
  },
  'header.language': {
    en: 'Language',
    zh: '语言',
    ms: 'Bahasa',
    ta: 'மொழி',
  },
  'header.profile': {
    en: 'Profile',
    zh: '资料',
    ms: 'Profil',
    ta: 'சுயவிவரம்',
  },
  'header.text': {
    en: 'Text',
    zh: '字号',
    ms: 'Teks',
    ta: 'எழுத்து',
  },

  // ── Hero "Pick Me Up Here!" Camera Landing ─────────────────────────────
  'hero.kicker': {
    en: 'Step 1 — Show Us Where You Are',
    zh: '第一步 — 让我们看看您的位置',
    ms: 'Langkah 1 — Tunjukkan Lokasi Anda',
    ta: 'படி 1 — நீங்கள் எங்கு இருக்கிறீர்கள் என்று காட்டுங்கள்',
  },
  'hero.subtitle': {
    en: 'Point your camera at your surroundings, then tap the big button. We will confirm your location and alert your family.',
    zh: '将相机对准周围环境，然后按大按钮。我们会确认您的位置并通知家人。',
    ms: 'Halakan kamera ke sekeliling anda, kemudian ketik butang besar. Kami akan sahkan lokasi anda dan maklumkan keluarga.',
    ta: 'உங்கள் சூழலை நோக்கி கேமராவை திருப்பி, பெரிய பொத்தானை அழுத்தவும். உங்கள் இடத்தை உறுதிப்படுத்தி குடும்பத்திற்கு அறிவிப்போம்.',
  },
  'hero.pickMeUp': {
    en: 'Pick Me Up Here!',
    zh: '来这里接我！',
    ms: 'Ambil Saya Di Sini!',
    ta: 'என்னை இங்கு அழைத்துச் செல்லுங்கள்!',
  },
  'hero.capturing': {
    en: 'Confirming your location...',
    zh: '正在确认您的位置…',
    ms: 'Mengesahkan lokasi anda...',
    ta: 'உங்கள் இடம் உறுதிப்படுத்தப்படுகிறது...',
  },
  'hero.cameraDenied': {
    en: 'Camera is off or unavailable. You can still tap the big button — we will use your GPS and a sample photo.',
    zh: '相机已关闭或无法使用。您仍可按大按钮 — 我们会使用GPS和示例照片。',
    ms: 'Kamera mati atau tidak tersedia. Anda masih boleh ketik butang besar — kami akan guna GPS dan gambar contoh.',
    ta: 'கேமரா இல்லை. நீங்கள் இன்னும் பெரிய பொத்தானை அழுத்தலாம் — GPS மற்றும் மாதிரி புகைப்படம் பயன்படுத்தப்படும்.',
  },
  'hero.enableCamera': {
    en: 'Turn On Camera',
    zh: '开启相机',
    ms: 'Hidupkan Kamera',
    ta: 'கேமராவை இயக்கு',
  },

  // ── First-launch Onboarding ─────────────────────────────────────────────
  'onboard.welcomeTitle': {
    en: 'Welcome to SafeSpot.SG',
    zh: '欢迎使用 SafeSpot.SG',
    ms: 'Selamat datang ke SafeSpot.SG',
    ta: 'SafeSpot.SG-க்கு வரவேற்கிறோம்',
  },
  'onboard.welcomeBody': {
    en: 'Let us set up your details once. Then getting picked up is a single tap.',
    zh: '我们先设置一次您的资料。之后接您只需按一下。',
    ms: 'Mari sediakan maklumat anda sekali sahaja. Selepas itu, cukup satu ketikan.',
    ta: 'உங்கள் விவரங்களை ஒருமுறை அமைப்போம். பிறகு ஒரே தட்டலில் அழைக்கலாம்.',
  },
  'onboard.start': {
    en: 'Get Started',
    zh: '开始',
    ms: 'Mula',
    ta: 'தொடங்கு',
  },
  'onboard.stepProfile': {
    en: 'About You',
    zh: '关于您',
    ms: 'Tentang Anda',
    ta: 'உங்களைப் பற்றி',
  },
  'onboard.stepPlaces': {
    en: 'Your Places',
    zh: '您的地点',
    ms: 'Tempat Anda',
    ta: 'உங்கள் இடங்கள்',
  },
  'onboard.stepContacts': {
    en: 'Who To Call',
    zh: '联系人',
    ms: 'Siapa Untuk Dihubungi',
    ta: 'யாரை அழைப்பது',
  },
  'onboard.name': {
    en: 'Your name',
    zh: '您的姓名',
    ms: 'Nama anda',
    ta: 'உங்கள் பெயர்',
  },
  'onboard.phone': {
    en: 'Your phone number',
    zh: '您的电话号码',
    ms: 'Nombor telefon anda',
    ta: 'உங்கள் தொலைபேசி எண்',
  },
  'onboard.dob': {
    en: 'Date of birth',
    zh: '出生日期',
    ms: 'Tarikh lahir',
    ta: 'பிறந்த தேதி',
  },
  'onboard.bloodType': {
    en: 'Blood type',
    zh: '血型',
    ms: 'Jenis darah',
    ta: 'இரத்த வகை',
  },
  'onboard.photo': {
    en: 'Add a photo of yourself',
    zh: '添加您的照片',
    ms: 'Tambah gambar anda',
    ta: 'உங்கள் புகைப்படத்தைச் சேர்க்கவும்',
  },
  'onboard.photoWhy': {
    en: 'Helps a driver or paramedic recognise you.',
    zh: '帮助司机或急救人员认出您。',
    ms: 'Membantu pemandu atau paramedik mengenali anda.',
    ta: 'ஓட்டுநர் அல்லது மருத்துவர் உங்களை அடையாளம் காண உதவும்.',
  },
  'onboard.takeSelfie': {
    en: 'Take Live Photo',
    zh: '拍摄实时照片',
    ms: 'Ambil Foto Langsung',
    ta: 'நேரலை புகைப்படம் எடு',
  },
  'onboard.retakeSelfie': {
    en: 'Retake Photo',
    zh: '重拍照片',
    ms: 'Ambil Semula Foto',
    ta: 'மீண்டும் புகைப்படம் எடு',
  },
  'onboard.cameraUnavailable': {
    en: 'No live camera here, so the photo is skipped. Photos must be taken live to stay authentic — you can add one later from your profile.',
    zh: '此设备无法使用实时相机，照片已跳过。为确保真实，照片必须实时拍摄——您可稍后在个人资料中添加。',
    ms: 'Tiada kamera langsung di sini, jadi foto dilangkau. Foto mesti diambil secara langsung supaya asli — anda boleh menambahnya kemudian dari profil anda.',
    ta: 'இங்கு நேரலை கேமரா இல்லை, புகைப்படம் தவிர்க்கப்பட்டது. உண்மையாக இருக்க புகைப்படம் நேரலையில் எடுக்கப்பட வேண்டும் — பிறகு சுயவிவரத்திலிருந்து சேர்க்கலாம்.',
  },
  'onboard.importContacts': {
    en: 'Import From Phone Contacts',
    zh: '从手机通讯录导入',
    ms: 'Import Dari Kenalan Telefon',
    ta: 'தொலைபேசி தொடர்புகளிலிருந்து இறக்குமதி',
  },
  'onboard.addManually': {
    en: 'Add by typing',
    zh: '手动输入添加',
    ms: 'Tambah secara manual',
    ta: 'தட்டச்சு செய்து சேர்க்கவும்',
  },
  'onboard.emergencyLocked': {
    en: 'SCDF 995 is always here and cannot be removed.',
    zh: 'SCDF 995 始终存在，无法删除。',
    ms: 'SCDF 995 sentiasa ada dan tidak boleh dibuang.',
    ta: 'SCDF 995 எப்போதும் இருக்கும், நீக்க முடியாது.',
  },
  'onboard.back': {
    en: 'Back',
    zh: '返回',
    ms: 'Kembali',
    ta: 'பின்செல்',
  },
  'onboard.next': {
    en: 'Next',
    zh: '下一步',
    ms: 'Seterusnya',
    ta: 'அடுத்து',
  },
  'onboard.finish': {
    en: 'Finish Setup',
    zh: '完成设置',
    ms: 'Selesai',
    ta: 'அமைப்பை முடிக்கவும்',
  },
  'onboard.skip': {
    en: 'Skip for now',
    zh: '暂时跳过',
    ms: 'Langkau buat masa ini',
    ta: 'இப்போதைக்கு தவிர்க்கவும்',
  },

  // ── Live Location Card ──────────────────────────────────────────────────
  'live.readAddress': {
    en: 'Read Address Out Loud',
    zh: '大声读出地址',
    ms: 'Baca Alamat Dengan Kuat',
    ta: 'முகவரியை சத்தமாக படி',
  },
  'live.readingAddress': {
    en: 'Reading Address...',
    zh: '正在读出地址…',
    ms: 'Membaca Alamat...',
    ta: 'முகவரி படிக்கப்படுகிறது...',
  },
  'live.updateLocation': {
    en: 'Update My Location',
    zh: '更新我的位置',
    ms: 'Kemas Kini Lokasi Saya',
    ta: 'என் இடத்தை புதுப்பி',
  },
  'live.updatingLocation': {
    en: 'Refreshing GPS...',
    zh: '正在更新GPS…',
    ms: 'Memuat Semula GPS...',
    ta: 'GPS புதுப்பிக்கப்படுகிறது...',
  },

  // ── One-Tap Share Panel ─────────────────────────────────────────────────
  'share.title': {
    en: 'One-Tap Pickup',
    zh: '一键接送',
    ms: 'Satu-Tap Ambil',
    ta: 'ஒரே தட்டலில் பிக்கப்',
  },
  'share.subtitle': {
    en: 'Tap any contact below to immediately send your exact verified location & photo',
    zh: '点选任何联系人，立即发送您已验证的位置和照片',
    ms: 'Ketik mana-mana kenalan untuk menghantar lokasi anda yang disahkan',
    ta: 'உங்கள் சரிபார்க்கப்பட்ட இடத்தை உடனடியாக அனுப்ப கீழே உள்ள தொடர்பை தட்டவும்',
  },
  'share.sendPin': {
    en: 'Send Pin',
    zh: '发送位置',
    ms: 'Hantar Pin',
    ta: 'இடத்தை அனுப்பு',
  },
  'share.call': {
    en: 'Call',
    zh: '打电话',
    ms: 'Panggil',
    ta: 'அழை',
  },
  'share.editContacts': {
    en: 'Edit Contacts',
    zh: '编辑联系人',
    ms: 'Sunting Kenalan',
    ta: 'தொடர்புகளை திருத்து',
  },
  'share.driverScreen': {
    en: 'Driver Screen',
    zh: '司机屏幕',
    ms: 'Skrin Pemandu',
    ta: 'ஓட்டுநர் திரை',
  },
  'share.alertFamily': {
    en: 'Alert Family & Live Track',
    zh: '通知家人并实时追踪',
    ms: 'Maklumkan Keluarga & Jejak Langsung',
    ta: 'குடும்பத்திற்கு எச்சரிக்கை & நேரடி கண்காணிப்பு',
  },
  'share.copyLink': {
    en: 'Copy Location Link',
    zh: '复制位置链接',
    ms: 'Salin Pautan Lokasi',
    ta: 'இட இணைப்பை நகலெடு',
  },
  'share.copied': {
    en: 'Link Copied!',
    zh: '链接已复制！',
    ms: 'Pautan Disalin!',
    ta: 'இணைப்பு நகலெடுக்கப்பட்டது!',
  },

  // ── Emergency SOS Banner ────────────────────────────────────────────────
  'sos.countdownTitle': {
    en: 'Emergency SCDF Dispatch in',
    zh: '紧急民防部队出动，倒计时',
    ms: 'Pasukan SCDF Kecemasan dalam',
    ta: 'அவசர SCDF அனுப்புகிறது',
  },
  'sos.countdownDesc': {
    en: 'Calling Singapore 995 (SCDF Ambulance) and dispatching live coordinates.',
    zh: '正在拨打新加坡995（民防救护车），并发送实时坐标。',
    ms: 'Memanggil 995 Singapura (Ambulans SCDF) dan menghantar koordinat langsung.',
    ta: 'சிங்கப்பூர் 995 (SCDF ஆம்புலன்ஸ்) அழைக்கப்பட்டு நேரடி ஆயத்தொலைவுகள் அனுப்பப்படுகின்றன.',
  },
  'sos.cancel': {
    en: 'Cancel Alert',
    zh: '取消警报',
    ms: 'Batal Amaran',
    ta: 'எச்சரிக்கையை ரத்து செய்',
  },

  // ── Fall Detection (P1 sensor) ──────────────────────────────────────────
  'fall.title': {
    en: 'Fall Detected. Are You Okay?',
    zh: '检测到跌倒。您还好吗？',
    ms: 'Jatuh Dikesan. Anda Okay?',
    ta: 'வீழ்ச்சி கண்டறியப்பட்டது. நீங்கள் நலமா?',
  },
  'fall.desc': {
    en: 'Tap the big button if you are safe. Emergency will call 995 automatically.',
    zh: '如果您平安，请按大按钮。否则将自动拨打995。',
    ms: 'Ketik butang jika anda selamat. Kecemasan akan hubungi 995 secara automatik.',
    ta: 'நீங்கள் பாதுகாப்பாக இருந்தால் பெரிய பொத்தானை அழுத்தவும். இல்லையெனில் 995 தானாக அழைக்கப்படும்.',
  },
  'fall.imOkay': {
    en: "I'M OKAY",
    zh: '我没事',
    ms: 'SAYA OKAY',
    ta: 'நான் நலம்',
  },

  // ── Caregiver Live Tracker (/track/:id) ─────────────────────────────────
  'tracker.title': {
    en: 'Live Senior Tracking',
    zh: '实时长辈追踪',
    ms: 'Penjejak Warga Emas Langsung',
    ta: 'மூத்தோர் நேரடி கண்காணிப்பு',
  },
  'tracker.battery': {
    en: 'Phone Battery',
    zh: '手机电量',
    ms: 'Bateri Telefon',
    ta: 'தொலைபேசி மின்கலம்',
  },
  'tracker.bloodType': {
    en: 'Blood Type',
    zh: '血型',
    ms: 'Jenis Darah',
    ta: 'இரத்த வகை',
  },
  'tracker.medicalNotes': {
    en: 'Medical Notes',
    zh: '医疗信息',
    ms: 'Nota Perubatan',
    ta: 'மருத்துவ குறிப்புகள்',
  },
  'tracker.landmarks': {
    en: 'Nearest Landmarks',
    zh: '附近地标',
    ms: 'Mercu Tanda Terdekat',
    ta: 'அருகிலுள்ள அடையாளங்கள்',
  },
  'tracker.lastUpdated': {
    en: 'Last updated',
    zh: '最后更新',
    ms: 'Terakhir dikemas kini',
    ta: 'கடைசியாக புதுப்பிக்கப்பட்டது',
  },
  'tracker.navigate': {
    en: 'Navigate',
    zh: '导航',
    ms: 'Navigasi',
    ta: 'வழிசெலுத்து',
  },
  'wearable.title': {
    en: 'Garmin Watch',
    zh: 'Garmin 手表',
    ms: 'Jam Tangan Garmin',
    ta: 'Garmin கைக்கடிகாரம்',
  },
  'wearable.sosActive': {
    en: 'SOS pressed on watch — check on them now',
    zh: '手表已按下 SOS — 请立即联系',
    ms: 'SOS ditekan pada jam — semak keadaan sekarang',
    ta: 'கைக்கடிகாரத்தில் SOS அழுத்தப்பட்டது — உடனே சரிபார்க்கவும்',
  },
  'wearable.fallDetected': {
    en: 'Possible fall detected by watch — no response, check on them now',
    zh: '手表检测到可能跌倒且无回应 — 请立即联系',
    ms: 'Kemungkinan jatuh dikesan oleh jam — tiada respons, semak keadaan sekarang',
    ta: 'கைக்கடிகாரம் விழுதலைக் கண்டறிந்தது — பதில் இல்லை, உடனே சரிபார்க்கவும்',
  },
  'wearable.hrAlert': {
    en: 'Abnormal heart rate on watch — no response, check on them now',
    zh: '手表显示心率异常且无回应 — 请立即联系',
    ms: 'Kadar denyutan jantung luar biasa pada jam — tiada respons, semak keadaan sekarang',
    ta: 'கைக்கடிகாரத்தில் அசாதாரண இதயத் துடிப்பு — பதில் இல்லை, உடனே சரிபார்க்கவும்',
  },
  'wearable.online': {
    en: 'Online',
    zh: '在线',
    ms: 'Dalam talian',
    ta: 'இணைப்பில்',
  },
  'wearable.offline': {
    en: 'Offline',
    zh: '离线',
    ms: 'Luar talian',
    ta: 'இணைப்பில் இல்லை',
  },
  'wearable.justNow': {
    en: 'just now',
    zh: '刚刚',
    ms: 'baru sahaja',
    ta: 'இப்போது',
  },
  'wearable.minAgo': {
    en: 'min ago',
    zh: '分钟前',
    ms: 'minit lalu',
    ta: 'நிமிடம் முன்',
  },
  'wearable.near': {
    en: 'Near',
    zh: '靠近',
    ms: 'Berhampiran',
    ta: 'அருகில்',
  },
  'wearable.openMap': {
    en: 'Open watch location',
    zh: '查看手表位置',
    ms: 'Buka lokasi jam',
    ta: 'கைக்கடிகார இருப்பிடத்தைத் திற',
  },
  'wearable.requestCheckin': {
    en: 'Ask if OK',
    zh: '询问是否平安',
    ms: 'Tanya jika selamat',
    ta: 'நலமா எனக் கேள்',
  },
  'wearable.checkinPending': {
    en: 'Check-in sent • Waiting for watch…',
    zh: '已发送询问 • 等待手表回应…',
    ms: 'Pertanyaan dihantar • Menunggu jam…',
    ta: 'கேள்வி அனுப்பப்பட்டது • காத்திருக்கிறது…',
  },
  'wearable.checkinOk': {
    en: 'Senior confirmed OK',
    zh: '长辈已确认平安',
    ms: 'Warga emas sahkan selamat',
    ta: 'மூத்தோர் நலம் என உறுதிப்படுத்தினார்',
  },
  'wearable.bgSync': {
    en: 'Background sync',
    zh: '后台同步',
    ms: 'Segerak latar',
    ta: 'பின்னணி ஒத்திசைவு',
  },
  'wearable.locationAge': {
    en: 'Location last updated',
    zh: '位置更新于',
    ms: 'Lokasi dikemas kini',
    ta: 'இருப்பிடம் புதுப்பிக்கப்பட்டது',
  },
  'wearable.pairingTitle': {
    en: 'Garmin Watch Pairing',
    zh: 'Garmin 手表配对',
    ms: 'Penyambungan Jam Garmin',
    ta: 'Garmin கைக்கடிகார இணைப்பு',
  },
  'wearable.pairingDesc': {
    en: 'Pair a Garmin fēnix watch for autonomous fall detection, heart rate alerts, and independent satellite GPS.',
    zh: '配对 Garmin fēnix 手表以启用自主跌倒检测、心率警报及独立卫星 GPS。',
    ms: 'Sambungkan jam Garmin fēnix untuk pengesanan jatuh automatik, amaran kadar jantung, dan GPS satelit langsung.',
    ta: 'தானியங்கி வீழ்ச்சி கண்டறிதல், இதயத் துடிப்பு எச்சரிக்கைகள் மற்றும் நேரடி செயற்கைக்கோள் ஜிபிஎஸ்-க்கு Garmin fēnix கைக்கடிகாரத்தை இணைக்கவும்.',
  },
  'wearable.deviceIdLabel': {
    en: 'Watch Device ID',
    zh: '手表设备编号',
    ms: 'ID Peranti Jam',
    ta: 'கைக்கடிகார சாதன அடையாளம்',
  },
  'wearable.deviceIdPlaceholder': {
    en: 'e.g. SS-7KQ2-M9XD-4TFH',
    zh: '例如 SS-7KQ2-M9XD-4TFH',
    ms: 'cth. SS-7KQ2-M9XD-4TFH',
    ta: 'எ.கா. SS-7KQ2-M9XD-4TFH',
  },
  'wearable.pairButton': {
    en: 'Pair Watch',
    zh: '配对手表',
    ms: 'Sambung Jam',
    ta: 'கைக்கடிகாரத்தை இணை',
  },
  'wearable.unpairButton': {
    en: 'Unpair Watch',
    zh: '解除配对',
    ms: 'Nyahsambung Jam',
    ta: 'இணைப்பை நீக்கு',
  },
  'wearable.pairingSuccess': {
    en: 'Watch paired successfully!',
    zh: '手表配对成功！',
    ms: 'Jam berjaya disambungkan!',
    ta: 'கைக்கடிகாரம் வெற்றிகரமாக இணைக்கப்பட்டது!',
  },
  'wearable.unpairedSuccess': {
    en: 'Watch unpaired.',
    zh: '已解除手表配对。',
    ms: 'Jam telah dinyahsambung.',
    ta: 'கைக்கடிகார இணைப்பு நீக்கப்பட்டது.',
  },
  'wearable.pairedBadge': {
    en: 'Paired & Active',
    zh: '已配对并启用',
    ms: 'Tersambung & Aktif',
    ta: 'இணைக்கப்பட்டு செயலில் உள்ளது',
  },
  'wearable.notPaired': {
    en: 'No watch paired',
    zh: '未配对手表',
    ms: 'Tiada jam disambungkan',
    ta: 'கைக்கடிகாரம் இணைக்கப்படவில்லை',
  },
  'wearable.howToFindId': {
    en: 'Find ID on watch: Hold UP (Menu) in the SafeSpot watch app.',
    zh: '在手表上查找编号：在 SafeSpot 手表应用中长按 UP（菜单键）。',
    ms: 'Cari ID pada jam: Tekan lama UP (Menu) dalam aplikasi jam SafeSpot.',
    ta: 'கைக்கடிகாரத்தில் அடையாளத்தைக் கண்டறிய: SafeSpot செயலியில் UP (மெனு) அழுத்திப் பிடிக்கவும்.',
  },
  'fusion.source': {
    en: 'Location Source',
    zh: '定位来源',
    ms: 'Sumber Lokasi',
    ta: 'இருப்பிட மூலம்',
  },
  'fusion.watchGps': {
    en: 'Garmin watch GPS',
    zh: 'Garmin 手表 GPS',
    ms: 'GPS jam Garmin',
    ta: 'Garmin கைக்கடிகார ஜிபிஎஸ்',
  },
  'fusion.combined': {
    en: 'Watch + phone GPS combined',
    zh: '手表与手机 GPS 合并',
    ms: 'GPS jam + telefon digabungkan',
    ta: 'கைக்கடிகாரம் + தொலைபேசி ஜிபிஎஸ் இணைக்கப்பட்டது',
  },
  'fusion.phoneBle': {
    en: 'BLE Beacon Micro-Location (Floor Precision • ±3m)',
    zh: 'BLE 蓝牙信标微定位 (楼层微定位 • ±3米)',
    ms: 'Lokasi Mikro Suar BLE (Ketepatan Tingkat • ±3m)',
    ta: 'BLE பீக்கான் நுண்ணிய இருப்பிடம் (தள துல்லியம் • ±3மீ)',
  },
  'fusion.phoneGps': {
    en: 'Phone GPS',
    zh: '手机 GPS',
    ms: 'GPS Telefon',
    ta: 'தொலைபேசி ஜிபிஎஸ்',
  },
  'fusion.floor': {
    en: 'Floor / Level',
    zh: '所在楼层',
    ms: 'Tingkat',
    ta: 'தளம்',
  },
  'fusion.venue': {
    en: 'Surveyed Venue',
    zh: '测绘场所',
    ms: 'Tempat Ukur',
    ta: 'கணக்கெடுக்கப்பட்ட இடம்',
  },
  'fusion.stale': {
    en: 'Last known fix (Stale)',
    zh: '最后已知位置 (较早)',
    ms: 'Lokasi terakhir diketahui (Lapuk)',
    ta: 'கடைசியாக அறியப்பட்ட இருப்பிடம் (பழையது)',
  },
  'tracker.statusActive': {
    en: 'ACTIVE — Senior needs assistance',
    zh: '进行中 — 长辈需要帮助',
    ms: 'AKTIF — Warga emas perlukan bantuan',
    ta: 'செயலில் — மூத்தோருக்கு உதவி தேவை',
  },
  'tracker.statusResolved': {
    en: 'Resolved — Senior is safe',
    zh: '已解决 — 长辈平安',
    ms: 'Selesai — Warga emas selamat',
    ta: 'முடிந்தது — மூத்தோர் பாதுகாப்பு',
  },
  'tracker.notFound': {
    en: 'Tracking link not found or expired. Please ask your family member to resend the alert.',
    zh: '找不到追踪链接或已过期。请让家人重新发送警报。',
    ms: 'Pautan penjejakan tidak dijumpai. Sila minta ahli keluarga menghantar semula amaran.',
    ta: 'கண்காணிப்பு இணைப்பு கிடைக்கவில்லை. உங்கள் குடும்ப உறுப்பினரிடம் மீண்டும் அனுப்பச் சொல்லவும்.',
  },
  'tracker.connecting': {
    en: 'Connecting to live incident telemetry...',
    zh: '正在连接长辈的实时求助信息...',
    ms: 'Menyambung ke telemetri insiden langsung...',
    ta: 'நேரலை சம்பவத் தகவலுடன் இணைக்கிறது...',
  },
  'tracker.waitingGps': {
    en: 'Waiting for first GPS fix...',
    zh: '正在等待首次GPS定位...',
    ms: 'Menunggu isyarat GPS pertama...',
    ta: 'முதல் GPS இணைப்பிற்காக காத்திருக்கிறது...',
  },
  'tracker.alertFall': {
    en: 'Fall Detected',
    zh: '检测到跌倒',
    ms: 'Jatuh Dikesan',
    ta: 'வீழ்ச்சி கண்டறியப்பட்டது',
  },
  'tracker.alertHr': {
    en: 'Heart Rate Alert',
    zh: '心率异常警报',
    ms: 'Amaran Kadar Jantung',
    ta: 'இதயத் துடிப்பு எச்சரிக்கை',
  },
  'tracker.alertCrash': {
    en: 'Crash Detected',
    zh: '检测到碰撞',
    ms: 'Kemalangan Dikesan',
    ta: 'விபத்து கண்டறியப்பட்டது',
  },
  'tracker.alertSos': {
    en: 'SOS Alert',
    zh: '紧急求救警报',
    ms: 'Amaran Kecemasan SOS',
    ta: 'அவசர SOS எச்சரிக்கை',
  },

  // ── Hero & Camera Extra ─────────────────────────────────────────────────
  'hero.orImAt': {
    en: "Or I'm at",
    zh: '或者我在',
    ms: 'Atau saya di',
    ta: 'அல்லது நான் உள்ள இடம்',
  },
  'hero.savePlacesTip': {
    en: 'Save your home, work & clinic for one-tap pickup',
    zh: '保存您的家、公司和诊所，方便一键接送',
    ms: 'Simpan rumah, tempat kerja & klinik untuk satu-tap',
    ta: 'ஒரே தட்டலில் அழைக்க வீடு, வேலை மற்றும் கிளினிக்கை சேமிக்கவும்',
  },
  'hero.youAreIndoors': {
    en: 'You are indoors',
    zh: '您在室内',
    ms: 'Anda berada di dalam bangunan',
    ta: 'நீங்கள் கட்டிடத்திற்குள் இருக்கிறீர்கள்',
  },
  'hero.readyAtRoadside': {
    en: 'Ready at the roadside',
    zh: '在路边等候',
    ms: 'Sedia di tepi jalan',
    ta: 'சாலையோரத்தில் தயார்',
  },
  'hero.listen': {
    en: 'Listen',
    zh: '播放语音',
    ms: 'Dengar',
    ta: 'கேட்கவும்',
  },
  'hero.stop': {
    en: 'Stop',
    zh: '停止',
    ms: 'Berhenti',
    ta: 'நிறுத்து',
  },
  'hero.stepOutTip': {
    en: 'Step out to the main taxi bay for pickup.',
    zh: '请走到主要的德士站等候接送。',
    ms: 'Sila keluar ke ruang teksi utama untuk diambil.',
    ta: 'பிக்கப்பிற்கு பிரதான டாக்ஸி பகுதிக்கு வரவும்.',
  },
  'hero.bleScanning': {
    en: 'Scanning for nearby beacons…',
    zh: '正在扫描附近信标…',
    ms: 'Mengimbas suar berdekatan…',
    ta: 'அருகிலுள்ள பீக்கான்களைத் தேடுகிறது…',
  },
  'hero.bleUnavailable': {
    en: 'Beacons unavailable here',
    zh: '此处无可用信标',
    ms: 'Suar tidak tersedia di sini',
    ta: 'இங்கு பீக்கான் கிடைக்கவில்லை',
  },
  'hero.bleNotSupported': {
    en: "This browser can't scan for Bluetooth beacons (iPhones never can). Nearby venues are still matched by GPS when you tap “Pick Me Up Here!”.",
    zh: '此浏览器无法扫描蓝牙信标（iPhone 均不支持）。点击“来这里接我”时，仍会通过 GPS 匹配附近地点。',
    ms: 'Pelayar ini tidak boleh mengimbas suar Bluetooth (iPhone tidak pernah boleh). Tempat berdekatan masih dipadankan melalui GPS apabila anda menekan “Ambil Saya Di Sini!”.',
    ta: 'இந்த உலாவியால் புளூடூத் பீக்கான்களை ஸ்கேன் செய்ய முடியாது (iPhone-இல் எப்போதும் முடியாது). நீங்கள் அழுத்தும்போது அருகிலுள்ள இடங்கள் GPS மூலம் பொருத்தப்படும்.',
  },
  'hero.bleOff': {
    en: 'Beacons off',
    zh: '信标已关闭',
    ms: 'Suar mati',
    ta: 'பீக்கான் அணைக்கப்பட்டது',
  },
  'hero.turnOn': {
    en: 'Turn on',
    zh: '开启',
    ms: 'Hidupkan',
    ta: 'இயக்கு',
  },
  'hero.turnOff': {
    en: 'Turn off',
    zh: '关闭',
    ms: 'Matikan',
    ta: 'அணை',
  },
  'hero.starting': {
    en: 'Starting…',
    zh: '正在启动…',
    ms: 'Memulakan…',
    ta: 'தொடங்குகிறது…',
  },

  // ── Live Location Card Extra ────────────────────────────────────────────
  'live.statusVerifying': {
    en: 'Verifying with Gemini & Maps...',
    zh: '正在使用 Gemini 和地图进行比对验证…',
    ms: 'Mengesahkan dengan Gemini & Peta...',
    ta: 'Gemini மற்றும் வரைபடங்கள் மூலம் சரிபார்க்கப்படுகிறது...',
  },
  'live.statusReady': {
    en: 'Live Pickup Location',
    zh: '实时接送地点',
    ms: 'Lokasi Pengambilan Langsung',
    ta: 'நேரலை பிக்கப் இடம்',
  },
  'live.locating': {
    en: 'Locating your current address...',
    zh: '正在获取您当前的地址…',
    ms: 'Mencari alamat semasa anda...',
    ta: 'உங்கள் தற்போதைய முகவரியைத் தேடுகிறது...',
  },
  'live.verified': {
    en: 'Verified',
    zh: '已验证',
    ms: 'Disahkan',
    ta: 'சரிபார்க்கப்பட்டது',
  },
  'live.accuracy': {
    en: 'Accuracy: ±',
    zh: '精确度: ±',
    ms: 'Ketepatan: ±',
    ta: 'துல்லியம்: ±',
  },
  'live.whereStanding': {
    en: 'Where you are standing',
    zh: '您所在的位置',
    ms: 'Di mana anda berdiri',
    ta: 'நீங்கள் நிற்கும் இடம்',
  },
  'live.indoors': {
    en: 'INDOORS',
    zh: '室内',
    ms: 'DALAM BANGUNAN',
    ta: 'உட்புறம்',
  },
  'live.pickupTip': {
    en: 'Pickup Tip',
    zh: '接送提示',
    ms: 'Petua Pengambilan',
    ta: 'பிக்கப் குறிப்பு',
  },
  'live.stepEntrance': {
    en: 'Please step towards the ground floor entrance or taxi bay.',
    zh: '请移步至一楼大门或德士等候区。',
    ms: 'Sila bergerak ke pintu masuk tingkat bawah atau ruang teksi.',
    ta: 'தரைத்தள நுழைவாயில் அல்லது டாக்ஸி பகுதிக்கு செல்லவும்.',
  },
  'live.aiInstructionsTitle': {
    en: 'AI Pickup Instructions for Driver & Caregiver',
    zh: '给司机和看护者的 AI 接送指南',
    ms: 'Arahan Pengambilan AI untuk Pemandu & Penjaga',
    ta: 'ஓட்டுநர் & பராமரிப்பாளருக்கான AI வழிகாட்டுதல்கள்',
  },
  'live.landmarks': {
    en: 'Landmarks',
    zh: '个地标',
    ms: 'Mercu Tanda',
    ta: 'அடையாளங்கள்',
  },
  'live.curbsideSnapped': {
    en: 'Curbside Snapped',
    zh: '路边精准对齐',
    ms: 'Tepi Jalan Tepat',
    ta: 'சாலையோர சீரமைப்பு',
  },
  'live.roadAligned': {
    en: 'Road Aligned',
    zh: '道路对齐',
    ms: 'Sejajar Jalan',
    ta: 'சாலை சீரமைப்பு',
  },
  'live.routesNavigation': {
    en: 'Routes API: Live Driver Navigation',
    zh: '路线 API: 实时司机导航',
    ms: 'API Laluan: Navigasi Pemandu Langsung',
    ta: 'வழிகள் API: நேரடி ஓட்டுநர் வழிசெலுத்தல்',
  },

  // ── Interactive Map Display ─────────────────────────────────────────────
  'map.title': {
    en: 'Live Map & Navigation Pin',
    zh: '实时地图与导航图钉',
    ms: 'Peta Langsung & Pin Navigasi',
    ta: 'நேரலை வரைபடம் & வழிசெலுத்தல் முள்',
  },
  'map.precision': {
    en: 'Precision coordinate:',
    zh: '精准坐标:',
    ms: 'Koordinat tepat:',
    ta: 'துல்லிய ஆயத்தொலைவு:',
  },
  'map.openFull': {
    en: 'Open in Full App',
    zh: '在地图应用中打开',
    ms: 'Buka di Aplikasi Penuh',
    ta: 'முழு செயலியில் திற',
  },
  'map.waiting': {
    en: 'Waiting for your location… Allow location access and tap “Update My Location”.',
    zh: '正在等待您的位置…请允许位置访问，然后点击“更新我的位置”。',
    ms: 'Menunggu lokasi anda… Benarkan akses lokasi dan tekan “Kemas Kini Lokasi Saya”.',
    ta: 'உங்கள் இருப்பிடத்திற்காகக் காத்திருக்கிறது… இருப்பிட அணுகலை அனுமதித்து, “என் இடத்தை புதுப்பி” என்பதை அழுத்தவும்.',
  },
  'map.gpsPin': {
    en: 'Your GPS position:',
    zh: '您的 GPS 位置：',
    ms: 'Kedudukan GPS anda:',
    ta: 'உங்கள் GPS இருப்பிடம்:',
  },
  'map.verifiedPin': {
    en: 'Verified Pin:',
    zh: '已验证图钉:',
    ms: 'Pin Disahkan:',
    ta: 'சரிபார்க்கப்பட்ட முள்:',
  },
  'map.coordinates': {
    en: 'Coordinates:',
    zh: '坐标:',
    ms: 'Koordinat:',
    ta: 'ஆயத்தொலைவுகள்:',
  },
  'map.navReady': {
    en: 'Navigation ready for Google Maps, Apple Maps & Waze',
    zh: '已为 Google 地图、Apple 地图与 Waze 准备好导航',
    ms: 'Sedia untuk Google Maps, Apple Maps & Waze',
    ta: 'Google Maps, Apple Maps மற்றும் Waze-க்கு வழிசெலுத்தல் தயார்',
  },

  // ── Pickup Dispatch Modal ───────────────────────────────────────────────
  'dispatch.kicker': {
    en: 'Pick Me Up Here',
    zh: '来这里接我',
    ms: 'Ambil Saya Di Sini',
    ta: 'என்னை இங்கு அழைக்கவும்',
  },
  'dispatch.sendTo': {
    en: 'Send to',
    zh: '发送给',
    ms: 'Hantar kepada',
    ta: 'அனுப்ப வேண்டியவர்',
  },
  'dispatch.verifiedSpot': {
    en: 'Verified Pickup Spot',
    zh: '已验证接送点',
    ms: 'Tempat Pengambilan Disahkan',
    ta: 'சரிபார்க்கப்பட்ட பிக்கப் இடம்',
  },
  'dispatch.driverNote': {
    en: 'Driver Note:',
    zh: '司机提示:',
    ms: 'Nota Pemandu:',
    ta: 'ஓட்டுநர் குறிப்பு:',
  },
  'dispatch.mapsReady': {
    en: 'Google Maps Pin Ready',
    zh: 'Google 地图图钉已就绪',
    ms: 'Pin Google Maps Sedia',
    ta: 'Google Maps முள் தயார்',
  },
  'dispatch.sending': {
    en: 'Sending Pin to',
    zh: '正在发送位置给',
    ms: 'Menghantar Pin kepada',
    ta: 'இடத்தை அனுப்புகிறது',
  },
  'dispatch.sent': {
    en: '✓ Pin Sent to',
    zh: '✓ 位置已发送给',
    ms: '✓ Pin Dihantar kepada',
    ta: '✓ இடம் அனுப்பப்பட்டது',
  },
  'dispatch.sendPin': {
    en: '1-Tap Send Pin to',
    zh: '一键发送位置给',
    ms: '1-Tap Hantar Pin kepada',
    ta: 'ஒரே தட்டலில் இடம் அனுப்பு',
  },
  'dispatch.sms': {
    en: 'SMS App',
    zh: '短信应用',
    ms: 'Aplikasi SMS',
    ta: 'SMS செயலி',
  },
  'dispatch.whatsapp': {
    en: 'WhatsApp',
    zh: 'WhatsApp',
    ms: 'WhatsApp',
    ta: 'WhatsApp',
  },
  'dispatch.call': {
    en: 'Call',
    zh: '拨打电话',
    ms: 'Panggil',
    ta: 'அழை',
  },
  'dispatch.copyLink': {
    en: 'Copy Location Link',
    zh: '复制位置链接',
    ms: 'Salin Pautan Lokasi',
    ta: 'இட இணைப்பை நகலெடு',
  },
  'dispatch.copied': {
    en: 'Link Copied!',
    zh: '链接已复制！',
    ms: 'Pautan Disalin!',
    ta: 'இணைப்பு நகலெடுக்கப்பட்டது!',
  },

  // ── Settings Modal ──────────────────────────────────────────────────────
  'settings.title': {
    en: 'App & Voice Settings',
    zh: '应用与语音设置',
    ms: 'Tetapan Aplikasi & Suara',
    ta: 'செயலி & குரல் அமைப்புகள்',
  },
  'settings.subtitle': {
    en: 'Customize Speechmatics voices, audio playback & visual accessibility',
    zh: '自定义 Speechmatics 语音、播放速度与视觉辅助',
    ms: 'Sesuaikan suara Speechmatics, kelajuan audio & kebolehcapaian',
    ta: 'Speechmatics குரல்கள், வேகம் மற்றும் காட்சி அமைப்புகளை மாற்றவும்',
  },
  'settings.voiceTitle': {
    en: 'Speechmatics Realtime Voice Engine',
    zh: 'Speechmatics 实时语音引擎',
    ms: 'Enjin Suara Speechmatics Langsung',
    ta: 'Speechmatics நேரலை குரல் பொறி',
  },
  'settings.speed': {
    en: 'Voice Speed / Cadence',
    zh: '语速调节',
    ms: 'Kelajuan Suara',
    ta: 'குரல் வேகம்',
  },
  'settings.visualTheme': {
    en: 'Visual Accessibility Theme',
    zh: '视觉无障碍主题',
    ms: 'Tema Kebolehcapaian Visual',
    ta: 'காட்சி அணுகல் தீம்',
  },
  'settings.textSize': {
    en: 'Text Size',
    zh: '字体大小',
    ms: 'Saiz Teks',
    ta: 'எழுத்து அளவு',
  },
  'settings.sensors': {
    en: 'Safety & Motion Sensors',
    zh: '安全与动作传感器',
    ms: 'Penderia Keselamatan & Pergerakan',
    ta: 'பாதுகாப்பு & இயக்க உணரிகள்',
  },
  'settings.fallDetection': {
    en: 'Elderly Fall Detection',
    zh: '长辈跌倒检测',
    ms: 'Pengesanan Jatuh Warga Emas',
    ta: 'மூத்தோர் வீழ்ச்சி கண்டறிதல்',
  },
  'settings.crashDetection': {
    en: 'Vehicle Impact Detection',
    zh: '车辆撞击检测',
    ms: 'Pengesanan Impak Kenderaan',
    ta: 'வாகன விபத்து கண்டறிதல்',
  },

  // ── Voice Command Overlay ───────────────────────────────────────────────
  'voice.title': {
    en: 'Voice Assistant',
    zh: '语音助手',
    ms: 'Pembantu Suara',
    ta: 'குரல் உதவியாளர்',
  },
  'voice.poweredBy': {
    en: 'Powered by Speechmatics Realtime SDK & Gemini Reasoning',
    zh: '由 Speechmatics 实时语音与 Gemini 推理引擎驱动',
    ms: 'Dikuasakan oleh Speechmatics Realtime SDK & Gemini Reasoning',
    ta: 'Speechmatics நேரலை SDK & Gemini மூலம் இயக்கப்படுகிறது',
  },
  'voice.tapToSpeak': {
    en: 'Tap microphone to speak',
    zh: '点击麦克风说话',
    ms: 'Ketik mikrofon untuk bercakap',
    ta: 'பேச மைக்ரோஃபோனைத் தட்டவும்',
  },
  'voice.listening': {
    en: 'Listening... Speak naturally',
    zh: '正在聆听… 请自然说话',
    ms: 'Mendengar... Bercakaplah seperti biasa',
    ta: 'கேட்கிறது... சாதாரணமாகப் பேசுங்கள்',
  },
  'voice.reasoning': {
    en: 'Gemini Reasoning in Progress...',
    zh: 'Gemini 正在分析您的指令…',
    ms: 'Gemini sedang memproses...',
    ta: 'Gemini சிந்திக்கிறது...',
  },
  'voice.voiceLabel': {
    en: 'Voice:',
    zh: '配音:',
    ms: 'Suara:',
    ta: 'குரல்:',
  },

  // ── Contacts Modal ──────────────────────────────────────────────────────
  'contacts.title': {
    en: 'Emergency & Family Contacts',
    zh: '紧急与家庭联系人',
    ms: 'Kenalan Kecemasan & Keluarga',
    ta: 'அவசர & குடும்ப தொடர்புகள்',
  },
  'contacts.subtitle': {
    en: "Who to notify when you tap 'Pick Me Up' or trigger SOS",
    zh: "当您按'来接我'或触发SOS时通知的对象",
    ms: "Siapa untuk dimaklumkan semasa 'Ambil Saya' atau SOS",
    ta: "'என்னை அழைக்கவும்' அல்லது SOS தட்டும்போது யாருக்கு அறிவிக்க வேண்டும்",
  },
  'contacts.addContact': {
    en: 'Add Contact',
    zh: '添加联系人',
    ms: 'Tambah Kenalan',
    ta: 'தொடர்பைச் சேர்',
  },
  'contacts.import': {
    en: 'Import From Phone',
    zh: '从手机导入',
    ms: 'Import Dari Telefon',
    ta: 'தொலைபேசியிலிருந்து இறக்குமதி',
  },
  'contacts.save': {
    en: 'Save Contacts',
    zh: '保存联系人',
    ms: 'Simpan Kenalan',
    ta: 'தொடர்புகளைச் சேமி',
  },
  'contacts.primary': {
    en: 'Primary Contact',
    zh: '主要联系人',
    ms: 'Kenalan Utama',
    ta: 'முதன்மை தொடர்பு',
  },
  'contacts.setPrimary': {
    en: 'Set as Primary',
    zh: '设为主要联系人',
    ms: 'Tetapkan sebagai Utama',
    ta: 'முதன்மை தொடர்பாக்க',
  },
  'contacts.name': {
    en: 'Name',
    zh: '姓名',
    ms: 'Nama',
    ta: 'பெயர்',
  },
  'contacts.phone': {
    en: 'Phone Number',
    zh: '电话号码',
    ms: 'Nombor Telefon',
    ta: 'தொலைபேசி எண்',
  },
  'contacts.relationship': {
    en: 'Relationship',
    zh: '关系',
    ms: 'Hubungan',
    ta: 'உறவு',
  },
  'contacts.lockedDesc': {
    en: 'Official Singapore Emergency Ambulance & Fire Rescue. Always active.',
    zh: '新加坡民防部队救护与消防官方热线。始终处于激活状态。',
    ms: 'Ambulans & Bomba Rasmi Singapura. Sentiasa aktif.',
    ta: 'சிங்கப்பூர் அதிகாரப்பூர்வ அவசர ஆம்புலன்ஸ் & தீயணைப்பு. எப்போதும் செயலில்.',
  },
  'contacts.delete': {
    en: 'Delete',
    zh: '删除',
    ms: 'Padam',
    ta: 'நீக்கு',
  },

  // ── Hero Camera Extra ───────────────────────────────────────────────────
  'hero.statusStrip': {
    en: 'Point & tap to be found',
    zh: '对准并点击以便被找到',
    ms: 'Halakan & ketik untuk dicari',
    ta: 'கண்டுபிடிக்க சுட்டிக்காட்டி தட்டவும்',
  },
  'hero.gpsReady': {
    en: 'GPS ready',
    zh: 'GPS 就绪',
    ms: 'GPS sedia',
    ta: 'GPS தயார்',
  },
  'hero.findingGps': {
    en: 'Finding GPS',
    zh: '正在搜寻 GPS',
    ms: 'Mencari GPS',
    ta: 'GPS தேடுகிறது',
  },
  'hero.cameraPausedBattery': {
    en: 'Camera paused to save battery',
    zh: '为节省电量已暂停相机',
    ms: 'Kamera dijeda untuk jimat bateri',
    ta: 'பேட்டரியை சேமிக்க கேமரா இடைநிறுத்தப்பட்டது',
  },
  'hero.resumeCamera': {
    en: 'Resume camera',
    zh: '恢复相机',
    ms: 'Sambung semula kamera',
    ta: 'கேமராவை மீண்டும் தொடங்கு',
  },
  'hero.tryAgain': {
    en: 'Try again',
    zh: '重试',
    ms: 'Cuba lagi',
    ta: 'மீண்டும் முயற்சி செய்',
  },
  'hero.startingCamera': {
    en: 'Starting camera…',
    zh: '正在启动相机…',
    ms: 'Memulakan kamera…',
    ta: 'கேமரா தொடங்குகிறது…',
  },
  'hero.holdPhoneLevel': {
    en: 'Hold phone level',
    zh: '请水平拿好手机',
    ms: 'Pegang telefon mendatar',
    ta: 'தொலைபேசியை சமமாகப் பிடிக்கவும்',
  },
  'hero.checkingWhere': {
    en: 'Checking where you are…',
    zh: '正在确认您的具体位置…',
    ms: 'Memeriksa lokasi anda…',
    ta: 'நீங்கள் எங்கு இருக்கிறீர்கள் என்று சரிபார்க்கிறது…',
  },
  'hero.nearbyVenue': {
    en: 'Nearby venue (GPS-matched)',
    zh: '附近场所 (GPS 匹配)',
    ms: 'Tempat berdekatan (padanan GPS)',
    ta: 'அருகிலுள்ள இடம் (GPS-பொருத்தம்)',
  },
  'hero.bleActive': {
    en: 'BLE Active',
    zh: '蓝牙信标活跃',
    ms: 'BLE Aktif',
    ta: 'BLE செயலில்',
  },

  // ── Share Panel Extra ───────────────────────────────────────────────────
  'share.preferred': {
    en: 'Preferred',
    zh: '常用',
    ms: 'Pilihan',
    ta: 'விருப்பமானது',
  },
  'share.sending': {
    en: 'Sending…',
    zh: '发送中…',
    ms: 'Menghantar…',
    ta: 'அனுப்புகிறது…',
  },
  'share.pinSent': {
    en: '✓ Pin Sent!',
    zh: '✓ 位置已发送！',
    ms: '✓ Pin Dihantar!',
    ta: '✓ முள் அனுப்பப்பட்டது!',
  },
  'share.pinSentToBanner': {
    en: '📍 Location Pin & Google Maps link sent to',
    zh: '📍 位置图钉与地图链接已发送至',
    ms: '📍 Pin Lokasi & pautan Peta dihantar kepada',
    ta: '📍 இட முள் & வரைபட இணைப்பு அனுப்பப்பட்டது',
  },
  'share.openMaps': {
    en: 'Open Maps',
    zh: '打开地图',
    ms: 'Buka Peta',
    ta: 'வரைபடத்தைத் திற',
  },
  'share.shareToAnyApp': {
    en: 'Share to Any App',
    zh: '分享到任何应用',
    ms: 'Kongsi ke Mana-mana Aplikasi',
    ta: 'எந்த செயலியிலும் பகிர்',
  },

  // ── Dispatch Modal Extra ────────────────────────────────────────────────
  'dispatch.openGoogleMaps': {
    en: 'Open Google Maps Pin',
    zh: '打开 Google 地图图钉',
    ms: 'Buka Pin Google Maps',
    ta: 'Google Maps முள்ளை திற',
  },
  'dispatch.share': {
    en: 'Share',
    zh: '分享',
    ms: 'Kongsi',
    ta: 'பகிர்',
  },
  'dispatch.copyText': {
    en: 'Copy Text',
    zh: '复制文本',
    ms: 'Salin Teks',
    ta: 'உரையை நகலெடு',
  },

  // ── Voice Command Extra ─────────────────────────────────────────────────
  'voice.transcribed': {
    en: 'Transcribed Voice:',
    zh: '转录语音:',
    ms: 'Suara Ditranskripsi:',
    ta: 'எழுதப்பட்ட குரல்:',
  },
  'voice.geminiDecision': {
    en: 'Gemini Assistant Decision',
    zh: 'Gemini 助手决策',
    ms: 'Keputusan Pembantu Gemini',
    ta: 'Gemini உதவியாளர் முடிவு',
  },
  'voice.quickPhrasesTitle': {
    en: 'Or tap a common Singapore senior phrase:',
    zh: '或直接点击新加坡长辈常用语:',
    ms: 'Atau ketik frasa biasa warga emas Singapura:',
    ta: 'அல்லது மூத்தோருக்கான பொதுவான சொற்றொடரைத் தட்டவும்:',
  },
  'voice.phraseWhere': {
    en: '“Where am I right now?”',
    zh: '“我现在在哪里？”',
    ms: '“Di mana saya sekarang?”',
    ta: '“நான் இப்போது எங்கே இருக்கிறேன்?”',
  },
  'voice.phraseSendSarah': {
    en: '“Send location to Sarah (Daughter)”',
    zh: '“发送位置给女儿 Sarah”',
    ms: '“Hantar lokasi kepada anak perempuan Sarah”',
    ta: '“மகள் சாராவுக்கு இருப்பிடத்தை அனுப்பு”',
  },
  'voice.phraseSurroundings': {
    en: '“Take a photo of my surroundings”',
    zh: '“拍一张我周围环境的照片”',
    ms: '“Ambil gambar sekeliling saya”',
    ta: '“என் சூழலின் புகைப்படத்தை எடு”',
  },
  'voice.phrase995': {
    en: '“Emergency 995 SCDF Ambulance”',
    zh: '“紧急拨打 995 民防救护车”',
    ms: '“Kecemasan 995 Ambulans SCDF”',
    ta: '“அவசர 995 SCDF ஆம்புலன்ஸ்”',
  },

  // ── Settings Modal Extra ────────────────────────────────────────────────
  'settings.active': {
    en: 'Active:',
    zh: '当前语音:',
    ms: 'Aktif:',
    ta: 'செயலில்:',
  },
  'settings.voicePrompt': {
    en: 'Select the voice persona used to read your verified location, safety guidelines, and driver pickup instructions. Tap Listen to sample each voice.',
    zh: '选择朗读已验证位置、安全指引和司机接送提示的语音人物。点击听听可试听每个声音。',
    ms: 'Pilih suara untuk membaca lokasi disahkan, panduan keselamatan dan arahan pemandu. Ketik Dengar untuk mencuba setiap suara.',
    ta: 'உங்கள் இடம் மற்றும் பாதுகாப்பு வழிகாட்டிகளை வாசிக்க குரலைத் தேர்ந்தெடுக்கவும். ஒலிக்கேட்க கேட்க என்பதைத் தட்டவும்.',
  },
  'settings.listen': {
    en: 'Listen',
    zh: '试听',
    ms: 'Dengar',
    ta: 'கேட்க',
  },
  'settings.stop': {
    en: 'Stop',
    zh: '停止',
    ms: 'Berhenti',
    ta: 'நிறுத்து',
  },
  'settings.selectVoice': {
    en: 'Select Voice',
    zh: '选择此语音',
    ms: 'Pilih Suara',
    ta: 'குரலைத் தேர்ந்தெடு',
  },
  'settings.selected': {
    en: 'Selected',
    zh: '已选择',
    ms: 'Dipilih',
    ta: 'தேர்ந்தெடுக்கப்பட்டது',
  },
  'settings.audioHeading': {
    en: 'Audio & Speech Guidance',
    zh: '语音与朗读偏好',
    ms: 'Panduan Audio & Suara',
    ta: 'ஆடியோ & குரல் வழிகாட்டுதல்',
  },
  'settings.autoSpoken': {
    en: 'Automatic Spoken Guidance',
    zh: '自动语音播报',
    ms: 'Panduan Suara Automatik',
    ta: 'தானியங்கி குரல் வழிகாட்டுதல்',
  },
  'settings.autoSpokenDesc': {
    en: 'Reads verified address, landmark visual clues, and safety tips automatically',
    zh: '自动朗读已验证地址、地标视觉线索和安全提示',
    ms: 'Membaca alamat disahkan, petunjuk mercu tanda dan petua keselamatan secara automatik',
    ta: 'சரிபார்க்கப்பட்ட முகவரி மற்றும் குறிப்புகளை தானாக வாசிக்கும்',
  },
  'settings.cadence': {
    en: 'Elder-Friendly Speaking Cadence',
    zh: '适合长辈的语速调节',
    ms: 'Kadar Pertuturan Mesra Warga Emas',
    ta: 'முதியோருக்கான குரல் வேகம்',
  },
  'settings.cadenceDesc': {
    en: 'Slower pace (0.85x) allows easier comprehension for senior listeners',
    zh: '较慢的语速 (0.85x) 便于年长者清晰理解',
    ms: 'Kadar lebih perlahan (0.85x) memudahkan pemahaman warga emas',
    ta: 'மெதுவான வேகம் (0.85x) மூத்தோர் எளிதாக புரிந்துகொள்ள உதவும்',
  },
  'settings.gentle': {
    en: 'Gentle (0.85x)',
    zh: '温和 (0.85x)',
    ms: 'Lembut (0.85x)',
    ta: 'மெதுவாக (0.85x)',
  },
  'settings.normal': {
    en: 'Normal (1.0x)',
    zh: '正常 (1.0x)',
    ms: 'Biasa (1.0x)',
    ta: 'சாதாரணமாக (1.0x)',
  },
  'settings.displayThemeHeading': {
    en: 'Display & High-Contrast Mode',
    zh: '显示与高对比度模式',
    ms: 'Paparan & Mod Kontras Tinggi',
    ta: 'காட்சி & அதிக மாறுபட்ட பயன்முறை',
  },
  'settings.textSizeHeading': {
    en: 'Text Size Scaling',
    zh: '字体大小缩放',
    ms: 'Penskalaan Saiz Teks',
    ta: 'எழுத்து அளவு மாற்றம்',
  },
  'settings.motionHeading': {
    en: 'Crash & Fall Sensor Protection',
    zh: '撞击与跌倒传感器保护',
    ms: 'Perlindungan Penderia Kemalangan & Jatuh',
    ta: 'விபத்து & வீழ்ச்சி உணரி பாதுகாப்பு',
  },
  'settings.motionDesc': {
    en: 'Uses high-G accelerometer vectors, gyroscope angular rotation, and GPS velocity shifts to automatically trigger cancelable SOS alerts.',
    zh: '利用高重力加速度、陀螺仪旋转角及GPS速度突变自动触发可取消的SOS警报。',
    ms: 'Menggunakan vektor pecutan G tinggi, putaran giroskop dan anjakan kelajuan GPS untuk mencetuskan amaran SOS boleh batal.',
    ta: 'உயர்-G முடுக்கமானி, கைரோஸ்கோப் மற்றும் GPS வேக மாற்றங்களைப் பயன்படுத்தி ரத்துசெய்யக்கூடிய SOS எச்சரிக்கைகளைத் தூண்டுகிறது.',
  },
  'settings.vehicleCrash': {
    en: 'Vehicle Crash Detection',
    zh: '车辆车祸撞击检测',
    ms: 'Pengesanan Kemalangan Kenderaan',
    ta: 'வாகன விபத்து கண்டறிதல்',
  },
  'settings.vehicleCrashDesc': {
    en: 'Detects sudden high-speed collisions (> 20 km/h + 3G+ impact shock)',
    zh: '检测突然的高速碰撞 (> 20 km/h 伴随 3G+ 剧烈震荡)',
    ms: 'Mengesan perlanggaran berkelajuan tinggi (> 20 km/j + gegaran 3G+)',
    ta: 'திடீர் அதிவேக மோதல்களைக் கண்டறியும் (> 20 km/h + 3G+ தாக்கம்)',
  },
  'settings.slipFall': {
    en: 'Slip & Fall Detection',
    zh: '长辈滑倒/跌倒检测',
    ms: 'Pengesanan Tergelincir & Jatuh',
    ta: 'வழுக்கி விழுதல் கண்டறிதல்',
  },
  'settings.slipFallDesc': {
    en: 'Detects free-fall drop followed by hard ground impact',
    zh: '检测身体失重坠落及伴随的地面撞击',
    ms: 'Mengesan kejatuhan bebas diikuti impak keras ke tanah',
    ta: 'நிலத்தில் கடினமாக மோதுவதைக் கண்டறியும்',
  },
  'settings.contactsHeading': {
    en: 'Caregivers & SOS 995',
    zh: '看护者与 995 紧急救援',
    ms: 'Penjaga & SOS 995',
    ta: 'பராமரிப்பாளர்கள் & SOS 995',
  },
  'settings.editContacts': {
    en: 'Edit Contacts →',
    zh: '编辑联系人 →',
    ms: 'Sunting Kenalan →',
    ta: 'தொடர்புகளைத் திருத்து →',
  },
  'common.done': {
    en: 'Done',
    zh: '完成',
    ms: 'Selesai',
    ta: 'முடிந்தது',
  },

  // ── Caregiver & Driver Preview Screen ──────────────────────────────────
  'caregiver.kicker': {
    en: 'Driver & Caregiver Live Screen',
    zh: '司机与看护者实时屏幕',
    ms: 'Skrin Langsung Pemandu & Penjaga',
    ta: 'ஓட்டுநர் & பராமரிப்பாளர் நேரலைத் திரை',
  },
  'caregiver.title': {
    en: 'Pickup Navigation Display',
    zh: '接送导航显示',
    ms: 'Paparan Navigasi Pengambilan',
    ta: 'பிக்கப் வழிசெலுத்தல் திரை',
  },
  'caregiver.travelTime': {
    en: 'Your Live Travel Time',
    zh: '您的实时路程时间',
    ms: 'Masa Perjalanan Langsung Anda',
    ta: 'உங்கள் நேரடி பயண நேரம்',
  },
  'caregiver.etaHint': {
    en: 'Open Google Maps below for a traffic-aware ETA from your current location.',
    zh: '点击下方打开 Google 地图，获取从您当前位置出发的实时路况预估时间。',
    ms: 'Buka Google Maps di bawah untuk anggaran masa tiba (ETA) berasaskan trafik dari lokasi semasa anda.',
    ta: 'தற்போதைய இடத்திலிருந்து போக்குவரத்து நேரத்தை அறிய கீழே Google Maps-ஐ திறக்கவும்.',
  },
  'caregiver.verifiedSpot': {
    en: 'Exact Verified Pickup Location',
    zh: '精确验证接送地点',
    ms: 'Lokasi Pengambilan Tepat Disahkan',
    ta: 'துல்லியமாக சரிபார்க்கப்பட்ட இடம்',
  },
  'caregiver.precisionSummary': {
    en: 'Verified with Places API Landmarks & Roads API Curbside Snapping',
    zh: '已通过 Places API 地标与 Roads API 路边对齐双重验证',
    ms: 'Disahkan dengan Mercu Tanda API Places & Penjajaran Tepi Jalan API Roads',
    ta: 'Places API மற்றும் Roads API மூலம் சரிபார்க்கப்பட்டது',
  },
  'caregiver.precisionLayer': {
    en: 'Multi-API Precision Layer',
    zh: '多 API 高精度图层',
    ms: 'Lapisan Ketepatan Berbilang API',
    ta: 'மல்டி-API துல்லிய அடுக்கு',
  },
  'caregiver.placesApiDesc': {
    en: 'Identifies nearby stores, entrances & visual landmarks.',
    zh: '识别附近商铺、出入口与视觉地标。',
    ms: 'Mengenal pasti kedai, pintu masuk & mercu tanda visual.',
    ta: 'அருகிலுள்ள கடைகள், நுழைவாயில்கள் மற்றும் அடையாளங்களை அடையாளம் காட்டுகிறது.',
  },
  'caregiver.roadsApiDesc': {
    en: 'Snaps raw GPS drift to the exact drivable curbside.',
    zh: '将飘移的 GPS 偏差精确对齐到可行驶的路边。',
    ms: 'Menjajarkan drift GPS ke tepi jalan boleh pandu yang tepat.',
    ta: 'GPS பிழையை துல்லியமான சாலையோரத்திற்கு சீரமைக்கிறது.',
  },
  'caregiver.routesApiDesc': {
    en: 'Computes real-time traffic-aware ETA & turn navigation.',
    zh: '计算实时路况预估时间与逐向导航。',
    ms: 'Mengira ETA berasaskan trafik masa nyata & navigasi selekoh.',
    ta: 'நேரலை போக்குவரத்து ETA மற்றும் வழிகாட்டுதலை கணக்கிடுகிறது.',
  },
  'caregiver.driverNotes': {
    en: 'Driver Instructions',
    zh: '司机接送指示',
    ms: 'Arahan Pemandu',
    ta: 'ஓட்டுநர் வழிமுறைகள்',
  },
  'caregiver.seniorSnapshot': {
    en: 'Surroundings Snapshot Provided by Senior',
    zh: '长辈拍摄的环境现场照片',
    ms: 'Foto Persekitaran Disediakan oleh Warga Emas',
    ta: 'மூத்தவர் வழங்கிய சூழல் புகைப்படம்',
  },
  'caregiver.noPhoto': {
    en: 'No live photo yet — captured when the senior taps “Pick Me Up Here!”',
    zh: '暂无现场照片 — 长辈点击“来这里接我！”时会自动拍摄',
    ms: 'Belum ada foto langsung — dirakam apabila warga emas mengetik “Ambil Saya Di Sini!”',
    ta: 'நேரலை புகைப்படம் இல்லை — “இங்கு அழைக்கவும்” என்பதை தட்டும்போது எடுக்கப்படும்',
  },
  'caregiver.seniorPhotoBadge': {
    en: "Senior's Live Photo",
    zh: '长辈实时照片',
    ms: 'Foto Langsung Warga Emas',
    ta: 'மூத்தவரின் நேரலை படம்',
  },
  'caregiver.streetViewNoAvailable': {
    en: 'Street View is not available at this spot.',
    zh: '该地点暂无街景。',
    ms: 'Street View tidak tersedia di tempat ini.',
    ta: 'இங்கு Street View கிடைக்கவில்லை.',
  },
  'caregiver.streetViewBadge': {
    en: 'Google Street View Reference',
    zh: 'Google 街景参考',
    ms: 'Rujukan Google Street View',
    ta: 'Google Street View குறிப்பு',
  },
  'caregiver.openMapsNav': {
    en: 'Open Google Maps Turn Navigation',
    zh: '打开 Google 地图实时导航',
    ms: 'Buka Navigasi Google Maps',
    ta: 'Google Maps வழிசெலுத்தலை திற',
  },
  'caregiver.noVerifiedLoc': {
    en: 'No verified location yet',
    zh: '暂无已验证位置',
    ms: 'Belum ada lokasi disahkan',
    ta: 'சரிபார்க்கப்பட்ட இடம் இல்லை',
  },
  'caregiver.donePreview': {
    en: 'Done Previewing',
    zh: '完成预览',
    ms: 'Selesai Pratonton',
    ta: 'பார்வையிடல் முடிந்தது',
  },
};

/**
 * Translate a key into the given language, falling back to English.
 */
export function t(key: string, language: Language = 'en'): string {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  return entry[language] || entry.en || key;
}

/**
 * Returns the BCP-47 speech locale for Web Speech synthesis of a language.
 */
export function speechLocaleFor(language: Language): string {
  return LANGUAGE_OPTIONS.find((l) => l.id === language)?.speechLocale || 'en-SG';
}
