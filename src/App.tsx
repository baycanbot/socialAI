import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, FileText, Wand2, Download, CheckCircle2, Loader2, LayoutTemplate, ChevronRight, RefreshCw, Copy, Plus, Building2, Trash2, Archive, Video, History, Sparkles, ImagePlus, X, Info, Settings, Send, ExternalLink, Github } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateConcepts, generateImage, generateVideo, Concept } from './lib/gemini';
import { fileToBase64, overlayLogo, LogoPosition } from './utils/imageUtils';
import { useCompanies, Company } from './hooks/useCompanies';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import localforage from 'localforage';

// Initialize localforage
localforage.config({
  name: 'InstaDonusumAI',
  storeName: 'history_store'
});

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface GeneratedImage extends Concept {
  baseImage: string;
  finalImage: string;
  videoUrl?: string;
  isVideoGenerating?: boolean;
}

interface HistoryItem {
  id: string;
  date: number;
  type: 'campaign' | 'quick_video';
  prompt: string;
  imageUrl: string;
  videoBlob?: Blob;
  videoUrl?: string; // object URL for current session
}

export default function App() {
  const { companies, addCompany, deleteCompany } = useCompanies();
  const [activeTab, setActiveTab] = useState<'campaign' | 'quick_video' | 'history' | 'settings'>('campaign');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  
  // Settings State
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState(() => localStorage.getItem('n8n_webhook_url') || '');
  const [isSendingToN8n, setIsSendingToN8n] = useState<number | null>(null);
  const [n8nSuccess, setN8nSuccess] = useState<number | null>(null);

  // Step 1 State (Company Management)
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  
  // New Company Form State
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyInfo, setNewCompanyInfo] = useState('');
  const [newCompanyLogo, setNewCompanyLogo] = useState<string | null>(null);

  // Step 2 State
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterBase64, setPosterBase64] = useState<string | null>(null);
  const [description, setDescription] = useState('');

  // Step 3 State
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Quick Video State
  const [quickImageFile, setQuickImageFile] = useState<File | null>(null);
  const [quickImageBase64, setQuickImageBase64] = useState<string | null>(null);
  const [quickPrompt, setQuickPrompt] = useState('');
  const [isQuickGenerating, setIsQuickGenerating] = useState(false);
  const [quickResult, setQuickResult] = useState<HistoryItem | null>(null);

  const translateError = (message: string): string => {
    if (message.includes("photorealistic children")) {
      return "Güvenlik Politikası: Gerçekçi çocuk görselleri içeren resimlerden video oluşturulamıyor. Lütfen farklı bir görsel deneyin.";
    }
    if (message.includes("safety filters")) {
      return "Güvenlik Politikası: Görsel veya açıklama güvenlik filtrelerine takıldı. Lütfen içeriği değiştirip tekrar deneyin.";
    }
    if (message.includes("Requested entity was not found")) {
      return "Seçtiğiniz API anahtarının video üretme (Veo) yetkisi yok veya faturalandırması kapalı. Lütfen geçerli bir anahtar seçin.";
    }
    return message;
  };

  // History State
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const items: HistoryItem[] = [];
      await localforage.iterate((value: HistoryItem, key, iterationNumber) => {
        // Recreate object URLs for blobs
        if (value.videoBlob) {
          value.videoUrl = URL.createObjectURL(value.videoBlob);
        }
        items.push(value);
      });
      // Sort by date descending
      items.sort((a, b) => b.date - a.date);
      setHistoryItems(items);
    } catch (err) {
      console.error("Failed to load history", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const saveToHistory = async (item: HistoryItem) => {
    try {
      await localforage.setItem(item.id, item);
      setHistoryItems(prev => [item, ...prev].sort((a, b) => b.date - a.date));
    } catch (err) {
      console.error("Failed to save to history", err);
    }
  };

  const deleteFromHistory = async (id: string) => {
    try {
      await localforage.removeItem(id);
      setHistoryItems(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error("Failed to delete from history", err);
    }
  };

  // Automatically show add form if no companies exist
  useEffect(() => {
    if (companies.length === 0 && !isAddingCompany) {
      setIsAddingCompany(true);
    }
  }, [companies.length]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const base64 = await fileToBase64(file);
      setNewCompanyLogo(base64);
    }
  };

  const handleSaveCompany = () => {
    if (!newCompanyName.trim() || !newCompanyInfo.trim()) return;
    
    const newComp = addCompany({
      name: newCompanyName,
      info: newCompanyInfo,
      logoBase64: newCompanyLogo
    });
    
    // Reset form
    setNewCompanyName('');
    setNewCompanyInfo('');
    setNewCompanyLogo(null);
    setIsAddingCompany(false);
    
    // Auto-select the newly created company
    setSelectedCompany(newComp);
    setStep(2);
  };

  const handleSelectCompany = (company: Company) => {
    setSelectedCompany(company);
    setStep(2);
  };

  const handlePosterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPosterFile(file);
      const base64 = await fileToBase64(file);
      setPosterBase64(base64);
    }
  };

  const handleGenerate = async () => {
    if (!selectedCompany) {
      setStep(1);
      return;
    }
    
    if (!posterBase64 || !description) {
      setError("Lütfen poster görselini ve açıklamasını ekleyin.");
      return;
    }
    
    setError(null);
    setIsGenerating(true);
    setStep(3);
    setGeneratedImages([]);
    
    try {
      setLoadingStatus('İçerik analiz ediliyor ve yaratıcı konseptler oluşturuluyor...');
      const concepts = await generateConcepts(posterBase64, posterFile!.type, description, selectedCompany.info);
      
      if (!concepts || concepts.length === 0) {
        throw new Error("Konsept oluşturulamadı. Lütfen tekrar deneyin.");
      }

      setLoadingStatus('Yapay zeka görselleri üretiyor (Bu işlem biraz sürebilir)...');
      
      const imagePromises = concepts.map(async (concept) => {
        const baseImage = await generateImage(concept.prompt);
        if (!baseImage) return null;
        
        let finalImage = baseImage;
        if (selectedCompany.logoBase64) {
          finalImage = await overlayLogo(baseImage, selectedCompany.logoBase64, concept.logoPosition as LogoPosition);
        }
        
        return { ...concept, baseImage, finalImage };
      });
      
      const results = await Promise.all(imagePromises);
      const validResults = results.filter(r => r !== null) as GeneratedImage[];
      
      if (validResults.length === 0) {
        throw new Error("Görseller oluşturulamadı.");
      }
      
      setGeneratedImages(validResults);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Bir hata oluştu.");
      setStep(2); // Go back on error
    } finally {
      setIsGenerating(false);
      setLoadingStatus('');
    }
  };

  const handleGenerateVideo = async (index: number) => {
    // Check for API key selection for Veo model
    if (window.aistudio) {
      try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      } catch (e) {
        console.error("API Key selection failed", e);
      }
    }

    setGeneratedImages(prev => {
      const newArr = [...prev];
      newArr[index] = { ...newArr[index], isVideoGenerating: true };
      return newArr;
    });

    try {
      const img = generatedImages[index];
      const videoUrl = await generateVideo(img.videoScript, img.finalImage);
      
      setGeneratedImages(prev => {
        const newArr = [...prev];
        newArr[index] = { ...newArr[index], isVideoGenerating: false, videoUrl: videoUrl || undefined };
        return newArr;
      });

      // Save to history
      if (videoUrl) {
        try {
          const vidRes = await fetch(videoUrl);
          const vidBlob = await vidRes.blob();
          const historyItem: HistoryItem = {
            id: `campaign_${Date.now()}_${index}`,
            date: Date.now(),
            type: 'campaign',
            prompt: img.prompt,
            imageUrl: img.finalImage,
            videoBlob: vidBlob,
            videoUrl: videoUrl
          };
          await saveToHistory(historyItem);
        } catch (e) {
          console.error("Failed to save video to history", e);
        }
      }

    } catch (err: any) {
      console.error("Video generation error:", err);
      
      let errorMessage = "Video üretimi başarısız oldu. Lütfen faturalandırması açık bir Google Cloud projesine ait API anahtarı seçtiğinizden emin olun.";
      if (err.message) {
        errorMessage = translateError(err.message);
        if (!errorMessage.includes(":") && !err.message.includes("Requested entity")) {
          errorMessage = `Video üretimi başarısız oldu: ${errorMessage}`;
        }
      }
      
      setError(errorMessage);
      
      setGeneratedImages(prev => {
        const newArr = [...prev];
        newArr[index] = { ...newArr[index], isVideoGenerating: false };
        return newArr;
      });
    }
  };

  const handleQuickVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setQuickImageFile(file);
      const base64 = await fileToBase64(file);
      setQuickImageBase64(base64);
    }
  };

  const handleQuickVideoGenerate = async () => {
    if (!quickImageBase64 || !quickPrompt) return;

    if (window.aistudio) {
      try {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      } catch (e) {
        console.error("API Key selection failed", e);
      }
    }

    setIsQuickGenerating(true);
    setError(null);

    try {
      const videoUrl = await generateVideo(quickPrompt, quickImageBase64);
      
      if (videoUrl) {
        const vidRes = await fetch(videoUrl);
        const vidBlob = await vidRes.blob();
        
        const historyItem: HistoryItem = {
          id: `quick_${Date.now()}`,
          date: Date.now(),
          type: 'quick_video',
          prompt: quickPrompt,
          imageUrl: quickImageBase64,
          videoBlob: vidBlob,
          videoUrl: videoUrl
        };
        
        await saveToHistory(historyItem);
        setQuickResult(historyItem);
      }
    } catch (err: any) {
      console.error("Quick video generation error:", err);
      let errorMessage = "Video üretimi başarısız oldu. Lütfen faturalandırması açık bir Google Cloud projesine ait API anahtarı seçtiğinizden emin olun.";
      if (err.message) {
        errorMessage = translateError(err.message);
        if (!errorMessage.includes(":") && !err.message.includes("Requested entity")) {
          errorMessage = `Video üretimi başarısız oldu: ${errorMessage}`;
        }
      }
      setError(errorMessage);
    } finally {
      setIsQuickGenerating(false);
    }
  };

  const handleCopyText = (caption: string, hashtags: string) => {
    navigator.clipboard.writeText(`${caption}\n\n${hashtags}`);
  };

  const handleDownload = (url: string, index: number, isVideo: boolean = false) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `insta-transform-${index + 1}.${isVideo ? 'mp4' : 'png'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendToN8n = async (img: GeneratedImage, index: number) => {
    if (!n8nWebhookUrl) {
      setError("Lütfen önce Ayarlar sekmesinden n8n Webhook URL'sini yapılandırın.");
      return;
    }

    setIsSendingToN8n(index);
    setN8nSuccess(null);
    
    try {
      const payload = {
        company: selectedCompany?.name,
        companyInfo: selectedCompany?.info,
        caption: img.caption,
        hashtags: img.hashtags,
        videoScript: img.videoScript,
        imageUrl: img.finalImage,
        videoUrl: img.videoUrl || null,
        timestamp: new Date().toISOString(),
        source: 'InstaDonusumAI'
      };

      const response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('n8n gönderimi başarısız oldu.');
      
      setN8nSuccess(index);
      setTimeout(() => setN8nSuccess(null), 3000);
    } catch (err: any) {
      console.error("n8n error:", err);
      setError(`n8n gönderim hatası: ${err.message}`);
    } finally {
      setIsSendingToN8n(null);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem('n8n_webhook_url', n8nWebhookUrl);
    setN8nSuccess(-1); // Use -1 for global success
    setTimeout(() => setN8nSuccess(null), 2000);
  };

  const handleDownloadZip = async () => {
    if (generatedImages.length === 0) return;
    
    const zip = new JSZip();
    const rootFolder = zip.folder(`${selectedCompany?.name.replace(/[^a-z0-9]/gi, '_') || 'Firma'}_Icerikler`);
    
    const zipPromises = generatedImages.map(async (img, idx) => {
      const conceptFolder = rootFolder?.folder(`Konsept_${idx + 1}`);
      
      // Add image (remove data URI prefix)
      const base64Data = img.finalImage.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
      conceptFolder?.file("gorsel.png", base64Data, {base64: true});
      
      // Add video if exists
      if (img.videoUrl) {
        try {
          const vidRes = await fetch(img.videoUrl);
          const vidBlob = await vidRes.blob();
          conceptFolder?.file("video.mp4", vidBlob);
        } catch (e) {
          console.error("Failed to zip video", e);
        }
      }
      
      // Add text
      const textContent = `POST METNİ:\n${img.caption}\n\nHASHTAGLER:\n${img.hashtags}\n\nVİDEO SENARYOSU (PROMPT):\n${img.videoScript}\n\n---\nFirma: ${selectedCompany?.name}`;
      conceptFolder?.file("icerik.txt", textContent);
    });
    
    await Promise.all(zipPromises);
    
    const content = await zip.generateAsync({type: "blob"});
    saveAs(content, "InstaDonusum_Icerikler.zip");
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600">
            <Wand2 className="w-6 h-6" />
            <span className="font-semibold text-lg tracking-tight">InstaDönüşüm AI</span>
          </div>
          
          {/* Stepper */}
          <div className="hidden md:flex items-center gap-4 text-sm font-medium text-neutral-500">
            <div className={`flex items-center gap-2 ${step >= 1 ? 'text-indigo-600' : ''}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 1 ? 'bg-indigo-100' : 'bg-neutral-100'}`}>1</div>
              Firma Seçimi
            </div>
            <ChevronRight className="w-4 h-4 opacity-50" />
            <div className={`flex items-center gap-2 ${step >= 2 ? 'text-indigo-600' : ''}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 2 ? 'bg-indigo-100' : 'bg-neutral-100'}`}>2</div>
              İçerik
            </div>
            <ChevronRight className="w-4 h-4 opacity-50" />
            <div className={`flex items-center gap-2 ${step >= 3 ? 'text-indigo-600' : ''}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 3 ? 'bg-indigo-100' : 'bg-neutral-100'}`}>3</div>
              Sonuç
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Tabs Navigation */}
        <div className="flex bg-white rounded-2xl shadow-sm border border-neutral-200 p-1 mb-8">
          <button
            onClick={() => setActiveTab('campaign')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'campaign' 
                ? 'bg-indigo-50 text-indigo-700 shadow-sm' 
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            AI Kampanya
          </button>
          <button
            onClick={() => setActiveTab('quick_video')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'quick_video' 
                ? 'bg-indigo-50 text-indigo-700 shadow-sm' 
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
          >
            <ImagePlus className="w-4 h-4" />
            Hızlı Video
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'history' 
                ? 'bg-indigo-50 text-indigo-700 shadow-sm' 
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
          >
            <History className="w-4 h-4" />
            Geçmiş
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'settings' 
                ? 'bg-indigo-50 text-indigo-700 shadow-sm' 
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            Ayarlar
          </button>
        </div>

        <AnimatePresence mode="wait">
          
          {/* CAMPAIGN TAB */}
          {activeTab === 'campaign' && (
            <motion.div
              key="tab-campaign"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {/* STEP 1: COMPANY MANAGEMENT */}
              {step === 1 && (
                <motion.div
              key="step1"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">Firma Seçimi</h1>
                <p className="text-neutral-500">İşlem yapmak istediğiniz firmayı seçin veya yeni bir firma ekleyin.</p>
              </div>

              {!isAddingCompany ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {companies.map(company => (
                      <div 
                        key={company.id} 
                        className="bg-white p-6 rounded-2xl shadow-sm border border-neutral-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer group relative flex flex-col"
                        onClick={() => handleSelectCompany(company)}
                      >
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteCompany(company.id); }}
                          className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                          title="Firmayı Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        
                        <div className="flex items-center gap-4 mb-4">
                          {company.logoBase64 ? (
                            <img src={company.logoBase64} alt={company.name} className="w-12 h-12 object-contain rounded-lg bg-neutral-50 p-1" />
                          ) : (
                            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                              <Building2 className="w-6 h-6" />
                            </div>
                          )}
                          <h3 className="font-semibold text-lg text-neutral-900 line-clamp-1">{company.name}</h3>
                        </div>
                        <p className="text-sm text-neutral-500 line-clamp-3 flex-grow">{company.info}</p>
                        
                        <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center text-indigo-600 text-sm font-medium">
                          Seç ve Devam Et <ChevronRight className="w-4 h-4 ml-1" />
                        </div>
                      </div>
                    ))}
                    
                    <button 
                      onClick={() => setIsAddingCompany(true)}
                      className="bg-neutral-50 border-2 border-dashed border-neutral-300 rounded-2xl p-6 flex flex-col items-center justify-center text-neutral-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all min-h-[200px]"
                    >
                      <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-3">
                        <Plus className="w-6 h-6" />
                      </div>
                      <span className="font-medium">Yeni Firma Ekle</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 max-w-2xl mx-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold">Yeni Firma Kaydı</h2>
                    {companies.length > 0 && (
                      <button 
                        onClick={() => setIsAddingCompany(false)}
                        className="text-sm text-neutral-500 hover:text-neutral-900"
                      >
                        İptal
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 mb-2">Firma Adı <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder="Örn: Acme Corp"
                        className="w-full p-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-neutral-700 mb-2">Firma Amacı ve Hizmetleri <span className="text-red-500">*</span></label>
                      <textarea
                        value={newCompanyInfo}
                        onChange={(e) => setNewCompanyInfo(e.target.value)}
                        placeholder="Firmanız ne yapıyor? Hangi hizmetleri sunuyor? (Örn: Sürdürülebilir enerji çözümleri sunan bir teknoloji şirketiyiz...)"
                        className="w-full h-24 p-4 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none transition-all"
                      />
                      <p className="text-xs text-neutral-500 mt-2">Bu bilgi, üretilecek post metinlerinin (caption) firmanızla uyumlu olmasını sağlar.</p>
                    </div>

                    <div className="pt-4 border-t border-neutral-100">
                      <label className="block text-sm font-medium text-neutral-700 mb-2">Logo (PNG önerilir - İsteğe bağlı)</label>
                      <div className="relative border-2 border-dashed border-neutral-300 rounded-xl p-6 hover:bg-neutral-50 transition-colors text-center cursor-pointer">
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleLogoUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        {newCompanyLogo ? (
                          <div className="flex flex-col items-center gap-3">
                            <img src={newCompanyLogo} alt="Logo preview" className="h-16 object-contain" />
                            <span className="text-sm text-indigo-600 font-medium">Logoyu Değiştir</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-neutral-500">
                            <div className="w-10 h-10 bg-neutral-100 rounded-full flex items-center justify-center">
                              <ImageIcon className="w-5 h-5" />
                            </div>
                            <div className="text-sm">
                              <span className="text-indigo-600 font-medium">Dosya seçin</span> veya sürükleyip bırakın
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={handleSaveCompany}
                      disabled={!newCompanyName.trim() || !newCompanyInfo.trim()}
                      className="w-full bg-neutral-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Firmayı Kaydet ve Devam Et
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* STEP 2: CONTENT */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8 max-w-2xl mx-auto"
            >
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-1.5 rounded-full text-sm font-medium mb-2">
                  <Building2 className="w-4 h-4" />
                  {selectedCompany?.name}
                </div>
                <h1 className="text-3xl font-semibold tracking-tight">İçeriğinizi Ekleyin</h1>
                <p className="text-neutral-500">Dönüştürmek istediğiniz posteri ve açıklamasını girin.</p>
              </div>

              <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 space-y-6">
                
                {error && (
                  <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex gap-3">
                  <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 space-y-1">
                    <p className="font-semibold">Video Üretim İpucu:</p>
                    <p>Yapay zeka güvenlik politikaları gereği, gerçekçi çocuk veya insan yüzleri içeren görsellerden video üretilemeyebilir. En iyi sonuç için ürün veya mekan odaklı görseller tercih edin.</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">Mevcut Poster / Görsel <span className="text-red-500">*</span></label>
                  <div className="relative border-2 border-dashed border-neutral-300 rounded-xl p-8 hover:bg-neutral-50 transition-colors text-center cursor-pointer">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handlePosterUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    {posterBase64 ? (
                      <div className="flex flex-col items-center gap-4">
                        <img src={posterBase64} alt="Poster preview" className="h-40 object-contain rounded-lg shadow-sm" />
                        <span className="text-sm text-indigo-600 font-medium">Görseli Değiştir</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-neutral-500">
                        <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center">
                          <LayoutTemplate className="w-6 h-6" />
                        </div>
                        <div className="text-sm">
                          <span className="text-indigo-600 font-medium">Poster seçin</span> veya sürükleyip bırakın
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">Post Açıklaması (Metin) <span className="text-red-500">*</span></label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Bu poster ne hakkında? Ana mesaj nedir?"
                    className="w-full h-32 p-4 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none transition-all"
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="text-neutral-500 px-6 py-3 rounded-xl font-medium hover:bg-neutral-100 transition-colors"
                >
                  Firma Değiştir
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!posterBase64 || !description}
                  className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-8 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-200"
                >
                  <Wand2 className="w-4 h-4" />
                  Görselleri Üret
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: RESULTS */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {isGenerating ? (
                <div className="bg-white p-12 rounded-2xl shadow-sm border border-neutral-200 flex flex-col items-center justify-center text-center space-y-6 min-h-[400px]">
                  <div className="relative">
                    <div className="absolute inset-0 bg-indigo-100 rounded-full blur-xl animate-pulse"></div>
                    <div className="w-16 h-16 bg-white rounded-full shadow-md flex items-center justify-center relative z-10">
                      <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">Sihir Gerçekleşiyor</h2>
                    <p className="text-neutral-500 max-w-sm mx-auto">{loadingStatus}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-3xl font-semibold tracking-tight">Üretilen Görseller ve İçerikler</h1>
                      <p className="text-neutral-500">İçeriğinizi temsil eden yaratıcı alternatifler ve post metinleri.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setStep(2)}
                        className="flex items-center gap-2 text-sm font-medium text-neutral-600 bg-white border border-neutral-200 px-4 py-2 rounded-lg hover:bg-neutral-50 transition-colors"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Yeni Üret
                      </button>
                      <button
                        onClick={handleDownloadZip}
                        className="flex items-center gap-2 text-sm font-medium text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
                      >
                        <Archive className="w-4 h-4" />
                        Tümünü İndir (ZIP)
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100 flex items-center justify-between">
                      <span>{error}</span>
                      <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-8">
                    {generatedImages.map((img, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.1 }}
                        key={idx} 
                        className="bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-200 flex flex-col md:flex-row"
                      >
                        <div className="w-full md:w-1/2 aspect-square relative bg-neutral-100 group">
                          {img.videoUrl ? (
                            <video 
                              src={img.videoUrl} 
                              autoPlay 
                              loop 
                              muted 
                              playsInline 
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <img 
                              src={img.finalImage} 
                              alt={`Generated ${idx + 1}`} 
                              className="w-full h-full object-cover"
                            />
                          )}
                          
                          {img.isVideoGenerating && (
                            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white p-4 text-center backdrop-blur-sm z-10">
                              <Loader2 className="w-8 h-8 animate-spin mb-3" />
                              <p className="text-sm font-medium">Video üretiliyor...</p>
                              <p className="text-xs opacity-75 mt-1">Bu işlem 2-3 dakika sürebilir</p>
                            </div>
                          )}

                          {!img.isVideoGenerating && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
                              {img.videoUrl ? (
                                <button
                                  onClick={() => handleDownload(img.videoUrl!, idx, true)}
                                  className="bg-white text-neutral-900 px-6 py-3 rounded-xl font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all"
                                >
                                  <Download className="w-4 h-4" />
                                  Videoyu İndir
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleDownload(img.finalImage, idx, false)}
                                    className="bg-white text-neutral-900 px-6 py-3 rounded-xl font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all"
                                  >
                                    <Download className="w-4 h-4" />
                                    Görseli İndir
                                  </button>
                                  <button
                                    onClick={() => handleGenerateVideo(idx)}
                                    className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all hover:bg-indigo-700 shadow-lg"
                                  >
                                    <Video className="w-4 h-4" />
                                    Videoya Dönüştür
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <div className="w-full md:w-1/2 p-6 md:p-8 flex flex-col justify-between bg-white">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-lg text-neutral-900">Post İçeriği {idx + 1}</h3>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleSendToN8n(img, idx)}
                                  disabled={isSendingToN8n === idx}
                                  className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-all ${
                                    n8nSuccess === idx 
                                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                                      : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-100'
                                  }`}
                                >
                                  {isSendingToN8n === idx ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : n8nSuccess === idx ? (
                                    <CheckCircle2 className="w-4 h-4" />
                                  ) : (
                                    <Send className="w-4 h-4" />
                                  )}
                                  {n8nSuccess === idx ? 'n8n\'e Gönderildi' : 'n8n\'e Gönder'}
                                </button>
                                <button
                                  onClick={() => handleCopyText(img.caption, img.hashtags)}
                                  className="text-neutral-500 hover:text-indigo-600 transition-colors flex items-center gap-1.5 text-sm font-medium bg-neutral-50 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-neutral-100"
                                >
                                  <Copy className="w-4 h-4" />
                                  Kopyala
                                </button>
                              </div>
                            </div>
                            <div className="prose prose-sm text-neutral-600 whitespace-pre-wrap">
                              <p>{img.caption}</p>
                              <p className="text-indigo-600 font-medium mt-4">{img.hashtags}</p>
                            </div>

                            <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-100">
                              <div className="flex items-center gap-2 text-neutral-700 font-semibold text-sm mb-2">
                                <Video className="w-4 h-4 text-indigo-600" />
                                Video Senaryosu (Prompt)
                              </div>
                              <p className="text-xs text-neutral-500 italic leading-relaxed">
                                {img.videoScript}
                              </p>
                            </div>
                          </div>
                          
                          <div className="mt-6 pt-6 border-t border-neutral-100">
                            <p className="text-xs text-neutral-400">
                              <span className="font-medium text-neutral-500">Yapay Zeka Notu:</span> Logo otomatik olarak {img.logoPosition.replace('-', ' ')} köşesine yerleştirildi.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
            </motion.div>
          )}

          {/* QUICK VIDEO TAB */}
          {activeTab === 'quick_video' && (
            <motion.div
              key="tab-quick-video"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8 max-w-2xl mx-auto"
            >
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">Görselden Hızlı Video</h1>
                <p className="text-neutral-500">Kendi görselinizi yükleyin ve yapay zeka ile hemen videoya dönüştürün.</p>
              </div>

              <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 space-y-6">
                {error && (
                  <div className="p-4 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex gap-3">
                  <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 space-y-1">
                    <p className="font-semibold">Video Üretim İpucu:</p>
                    <p>Yapay zeka güvenlik politikaları gereği, gerçekçi çocuk veya insan yüzleri içeren görsellerden video üretilemeyebilir. En iyi sonuç için ürün veya mekan odaklı görseller tercih edin.</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">Görsel Yükle <span className="text-red-500">*</span></label>
                  <div className="relative border-2 border-dashed border-neutral-300 rounded-xl p-8 hover:bg-neutral-50 transition-colors text-center cursor-pointer">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleQuickVideoUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    {quickImageBase64 ? (
                      <div className="flex flex-col items-center gap-4">
                        <img src={quickImageBase64} alt="Preview" className="h-40 object-contain rounded-lg shadow-sm" />
                        <span className="text-sm text-indigo-600 font-medium">Görseli Değiştir</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-neutral-500">
                        <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center">
                          <ImagePlus className="w-6 h-6" />
                        </div>
                        <div className="text-sm">
                          <span className="text-indigo-600 font-medium">Görsel seçin</span> veya sürükleyip bırakın
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-2">Video Promptu (İngilizce önerilir) <span className="text-red-500">*</span></label>
                  <textarea
                    value={quickPrompt}
                    onChange={(e) => setQuickPrompt(e.target.value)}
                    placeholder="Örn: A cinematic slow motion shot of this product..."
                    className="w-full h-32 p-4 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none transition-all"
                  />
                </div>
                
                <button
                  onClick={handleQuickVideoGenerate}
                  disabled={!quickImageBase64 || !quickPrompt || isQuickGenerating}
                  className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-8 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-200"
                >
                  {isQuickGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Video Üretiliyor (2-3 dk sürebilir)...
                    </>
                  ) : (
                    <>
                      <Video className="w-5 h-5" />
                      Videoyu Üret
                    </>
                  )}
                </button>
              </div>

              {quickResult && (
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 space-y-6">
                  <h2 className="text-xl font-semibold">Sonuç</h2>
                  <div className="aspect-square bg-neutral-100 rounded-xl overflow-hidden relative">
                    {quickResult.videoUrl ? (
                      <video 
                        src={quickResult.videoUrl} 
                        autoPlay 
                        loop 
                        muted 
                        playsInline 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img src={quickResult.imageUrl} alt="Result" className="w-full h-full object-cover" />
                    )}
                  </div>
                  {quickResult.videoUrl && (
                    <button
                      onClick={() => handleDownload(quickResult.videoUrl!, 0, true)}
                      className="w-full bg-neutral-900 text-white px-6 py-3 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-neutral-800 transition-colors"
                    >
                      <Download className="w-5 h-5" />
                      Videoyu İndir
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* HISTORY TAB */}
          {activeTab === 'history' && (
            <motion.div
              key="tab-history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">Geçmiş Üretimler</h1>
                <p className="text-neutral-500">Daha önce ürettiğiniz tüm videolar ve görseller burada saklanır.</p>
              </div>

              {isLoadingHistory ? (
                <div className="flex items-center justify-center p-12">
                  <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                </div>
              ) : historyItems.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl shadow-sm border border-neutral-200 text-center flex flex-col items-center">
                  <History className="w-12 h-12 text-neutral-300 mb-4" />
                  <h3 className="text-lg font-medium text-neutral-900">Henüz geçmiş yok</h3>
                  <p className="text-neutral-500 mt-2">Ürettiğiniz videolar burada listelenecektir.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {historyItems.map((item) => (
                    <div key={item.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-neutral-200 group relative">
                      <button 
                        onClick={() => deleteFromHistory(item.id)}
                        className="absolute top-4 right-4 z-20 p-2 bg-white/80 backdrop-blur-sm text-neutral-600 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                        title="Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      
                      <div className="aspect-square relative bg-neutral-100">
                        {item.videoUrl ? (
                          <video 
                            src={item.videoUrl} 
                            autoPlay 
                            loop 
                            muted 
                            playsInline 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img 
                            src={item.imageUrl} 
                            alt="History item" 
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-medium bg-neutral-100 text-neutral-600 px-2.5 py-1 rounded-md">
                            {new Date(item.date).toLocaleDateString('tr-TR')}
                          </span>
                          <span className="text-xs font-medium bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-md">
                            {item.type === 'campaign' ? 'Kampanya' : 'Hızlı Video'}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-600 line-clamp-2 mb-4" title={item.prompt}>
                          {item.prompt}
                        </p>
                        {item.videoUrl && (
                          <button
                            onClick={() => handleDownload(item.videoUrl!, 0, true)}
                            className="w-full bg-neutral-100 text-neutral-900 px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            İndir
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <motion.div
              key="tab-settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8 max-w-2xl mx-auto"
            >
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">Entegrasyon Ayarları</h1>
                <p className="text-neutral-500">Uygulamanızı n8n veya diğer sistemlerle bağlayın.</p>
              </div>

              <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 space-y-6">
                {n8nSuccess === -1 && (
                  <div className="p-4 bg-emerald-50 text-emerald-700 rounded-xl text-sm border border-emerald-100 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Ayarlar başarıyla kaydedildi.
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2 flex items-center gap-2">
                      <Send className="w-4 h-4 text-indigo-600" />
                      n8n Webhook URL
                    </label>
                    <input 
                      type="url" 
                      value={n8nWebhookUrl}
                      onChange={(e) => setN8nWebhookUrl(e.target.value)}
                      placeholder="https://n8n.your-domain.com/webhook/..."
                      className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    />
                    <p className="text-xs text-neutral-400 mt-2">
                      Üretilen içerikleri otomatik olarak n8n iş akışınıza göndermek için webhook URL'sini buraya yapıştırın.
                    </p>
                  </div>

                  <button 
                    onClick={handleSaveSettings}
                    className="w-full bg-indigo-600 text-white py-4 rounded-xl font-semibold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                  >
                    Ayarları Kaydet
                  </button>
                </div>

                <div className="pt-6 border-t border-neutral-100">
                  <h3 className="text-sm font-semibold text-neutral-900 mb-4 flex items-center gap-2">
                    <ExternalLink className="w-4 h-4 text-indigo-600" />
                    Yayınlama ve Dağıtım Rehberi
                  </h3>
                  <div className="space-y-4">
                    <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-100">
                      <p className="text-xs font-medium text-neutral-700 mb-1">Coolify ile Kendi Sunucuna Kur</p>
                      <p className="text-[10px] text-neutral-500 leading-relaxed">
                        Bu uygulamayı Coolify üzerinde Docker kullanarak saniyeler içinde yayına alabilirsiniz. Proje kök dizinindeki Dockerfile hazır durumdadır.
                      </p>
                    </div>
                    <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-100">
                      <p className="text-xs font-medium text-neutral-700 mb-1">GitHub Entegrasyonu</p>
                      <p className="text-[10px] text-neutral-500 leading-relaxed">
                        Kodu GitHub'a aktararak Vercel, Netlify veya Coolify üzerinden otomatik (CI/CD) yayınlama yapabilirsiniz.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
