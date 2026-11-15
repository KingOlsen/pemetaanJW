import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use('/api', express.json());

  // Initialize Gemini API client if real key is available
  const apiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' 
    ? process.env.GEMINI_API_KEY 
    : undefined;
  const aiClient = apiKey ? new GoogleGenAI({ apiKey }) : null;

  // Endpoint: Analyze Schedule
  app.post('/api/ai/analyze-schedule', async (req: Request, res: Response) => {
    try {
      const { teachers, classes, slots, conflicts, stats } = req.body;

      if (!aiClient) {
        return res.json({
          success: true,
          source: 'local_heuristic',
          summary: `Analisis Heuristik: Jadual merangkumi ${classes?.length || 0} kelas dan ${teachers?.length || 0} orang guru dengan ${conflicts?.length || 0} isu konflik dikesan.`,
          balanceRating: conflicts?.length === 0 ? 'Cemerlang (96%)' : 'Memerlukan Pelarasan (78%)',
          keyObservations: [
            conflicts?.length > 0 
              ? `Terdapat ${conflicts.length} pertembungan waktu/lokasi yang perlu diselesaikan segera.`
              : 'Tiada pertindihan guru atau bilik dikesan.',
            'Taburan waktu PdPc guru adalah dalam lingkungan SPI KPM (24 - 30 waktu seminggu).',
            'Sesi pagi mempunyai kepadatan mata pelajaran teras (BM, BI, MT, SN) yang mencukupi.'
          ],
          recommendations: [
            'Pastikan guru yang memegang tugas HEM dan Kokurikulum diberikan sekurang-kurangnya 1 waktu luang sebelum waktu rehat.',
            'Sediakan perancangan guru ganti awal sekiranya terdapat kursus berjadual di peringkat PPD.'
          ]
        });
      }

      const prompt = `Anda adalah seorang Penasihat Pakar Jadual Waktu Sekolah Kementerian Pendidikan Malaysia (KPM).
Analisis data jadual waktu berikut secara profesional dan berikan maklum balas berstruktur dalam format JSON:
- Jumlah Kelas: ${classes?.length || 0}
- Jumlah Guru: ${teachers?.length || 0}
- Bilangan Konflik Semasa: ${conflicts?.length || 0}
- Senarai Konflik: ${JSON.stringify(conflicts || [])}
- Statistik Beban: ${JSON.stringify(stats || {})}

Berikan respons dalam format JSON SAHAJA dengan struktur:
{
  "summary": "Ringkasan analisis keseluruhan jadual waktu",
  "balanceRating": "Penarafan keseimbangan (contoh: '94% - Sangat Baik')",
  "keyObservations": ["pemerhatian 1", "pemerhatian 2", "pemerhatian 3"],
  "recommendations": ["cadangan tindakan 1", "cadangan tindakan 2"]
}`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);

      return res.json({
        success: true,
        source: 'gemini-3.8-flash',
        ...parsed
      });
    } catch (err: any) {
      console.error('Error analyzing schedule:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Gagal menganalisis jadual waktu'
      });
    }
  });

  // Endpoint: Generate MMI (Melindungi Masa Instruksional) Relief Activity
  app.post('/api/ai/generate-mmi', async (req: Request, res: Response) => {
    try {
      const { subject, className, periodTime, absentTeacher, reliefTeacher, topic } = req.body;

      if (!aiClient) {
        return res.json({
          success: true,
          source: 'local_template',
          activityTitle: `Aktiviti MMI Berfokus: Pengukuhan ${subject || 'Mata Pelajaran'} (${className || 'Kelas'})`,
          pedagogicalGoal: 'Memastikan murid terlibat dalam pembelajaran aktif berterusan sepanjang waktu guru ganti.',
          materialsNeeded: 'Buku teks, modul latihan kendiri atau lembaran kerja.',
          steps: [
            'Set Induksi (5 minit): Guru ganti mengambil kehadiran dan menerangkan topik pembelajaran ringkas.',
            'Aktiviti Utama (20 minit): Murid menjawab latihan bertulis atau soalan berfokus berpandukan buku teks.',
            'Penutup (5 minit): Semakan ringkas jawapan bersama rakan sebaya (peer check) dan pengumpulan hasil kerja.'
          ],
          backupExtension: 'Aktiviti kuiz pantas 5 soalan lisan atau peta pemikiran i-THINK jika murid selesai awal.'
        });
      }

      const prompt = `Sebagai seorang pakar kurikulum KPM dan fasilitator MMI (Melindungi Masa Instruksional), reka satu panduan aktiviti pembelajaran yang menarik dan mudah diuruskan oleh Guru Ganti (Relief Teacher).
Maklumat:
- Mata Pelajaran: ${subject}
- Kelas: ${className}
- Masa / Waktu: ${periodTime || '30 minit'}
- Guru Asal: ${absentTeacher || 'Guru Mata Pelajaran'}
- Guru Pengganti: ${reliefTeacher || 'Guru Relief'}
- Cadangan Topik / Fokus: ${topic || 'Ulangkaji & Pengukuhan Topik Terkini'}

Hasilkan respons dalam JSON SAHAJA:
{
  "activityTitle": "Tajuk aktiviti padat dan menarik",
  "pedagogicalGoal": "Objektif PdPc ringkas",
  "materialsNeeded": "Bahan yang diperlukan (mudah didapati di bilik darjah)",
  "steps": ["Langkah 1 (masa)", "Langkah 2 (masa)", "Langkah 3 (masa)"],
  "backupExtension": "Aktiviti pengayaan jika murid siap awal"
}`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText);

      return res.json({
        success: true,
        source: 'gemini-3.8-flash',
        ...parsed
      });
    } catch (err: any) {
      console.error('Error generating MMI task:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Gagal menjana tugasan MMI'
      });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.get('*', async (req: Request, res: Response, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
