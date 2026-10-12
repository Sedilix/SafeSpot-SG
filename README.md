# SafeSpot.SG - Visual Location & Pickup Assistant

A Singapore live location and pickup assistant powered by **Gemini AI**, **Speechmatics Realtime Voice Engine (STT & TTS)**, and **Google Maps Platform** (Street View, Places, Roads, and Geocoding APIs).

---

## 🌟 Key Features

- **Gemini Multimodal Landmark Verification**: Cross-references user-taken photos and GPS coordinates with Google Street View and Google Places to identify distinctive visual landmarks (storefront signs, benches, shelters, building entrances).
- **Speechmatics Realtime Voice Engine**:
  - **Speech-to-Text (STT)**: Real-time microphone audio streaming via `@speechmatics/real-time-client` with live partial and final transcriptions.
  - **Text-to-Speech (TTS)**: Authentic Speechmatics voices (**Sarah** [UK Female], **Megan** [US Female], **Theo** [UK Male], and **Jack** [US Male]) with elder-friendly cadence (0.85x).
- **Driver Pickup Notes & Directions**: Formats concise, actionable pickup notes for drivers and caregivers with direct navigation links to Google Maps, Apple Maps, and Waze.
- **Singapore Emergency SOS (SCDF 995)**: Dedicated, accessible emergency dial trigger with a 5-second cancelable reassurance countdown.
- **Elderly High-Contrast Visual Modes**: Includes Yellow-on-Black (maximum contrast), High B&W, and Warm Amber display modes with dynamic text size scaling.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 18+
- npm or yarn

### 2. Installation
```bash
git clone https://github.com/Sedilix/SafeSpot-SG.git
cd SafeSpotSG
npm install
```

### 3. Environment Configuration
Create a `.env` file in the project root:
```env
# Gemini API Key for multimodal reasoning and location verification
GEMINI_API_KEY=your_gemini_api_key_here

# Speechmatics API Key for realtime STT and TTS
SPEECHMATICS_API_KEY=your_speechmatics_api_key_here

# Optional: Google Maps Platform API Key (for Places, Roads, Street View & Geocoding)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

### 4. Running the Development Server
```bash
npm run dev
```
The application will start at `http://localhost:3000`.

### 5. Production Build
```bash
npm run build
npm start
```

---

## 🛡️ License
Apache-2.0
