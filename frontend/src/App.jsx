import React, { useState, useRef } from 'react';
import axios from 'axios';

// Helper to detect Gemini retry/wait status from error message
function isGeminiRetryMessage(msg) {
  if (!msg) return false;
  return /quota|429|retry|wait|exceeded|overloaded|503|service unavailable/i.test(msg);
}

export default function SummarizerView() {
  const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [summary, setSummary] = useState('');
  const [keyPoints, setKeyPoints] = useState([]);
  const [improvementSuggestions, setImprovementSuggestions] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [meta, setMeta] = useState(null);
  const [chunkSummaries, setChunkSummaries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [length, setLength] = useState('medium');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [hover, setHover] = useState(false);

  // New: Track Gemini retry/wait status
  const [waitingForGemini, setWaitingForGemini] = useState(false);

  const inputRef = useRef();

  // Handle file selection
  const handleFile = (f) => {
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setSummary('');
    setKeyPoints([]);
    setImprovementSuggestions([]);
    setHighlights([]);
    setChunkSummaries([]);
    setMeta(null);
    setStatus('');
    setError(null);

    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const onFileChange = (e) => handleFile(e.target.files[0]);

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setHover(false);
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      handleFile(dt.files[0]);
    }
  };

  // Upload & summarize
  const upload = async () => {
    if (!file) return setError('Please select a file first');
    setLoading(true);
    setError(null);
    setStatus('Uploading and analyzing document...');
    setWaitingForGemini(false);
    setSummary('');
    setKeyPoints([]);
    setImprovementSuggestions([]);
    setHighlights([]);
    setChunkSummaries([]);
    setMeta(null);

    const form = new FormData();
    form.append('file', file);
    form.append('length', length);

    try {
      const resp = await axios.post(`${apiBaseUrl}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (!resp?.data?.success) {
        throw new Error(resp?.data?.error || 'Processing failed. Please try again.');
      }
      const payload = resp?.data?.data || {};
      setSummary(payload.summary || 'No summary generated.');
      setKeyPoints(payload.keyPoints || []);
      setImprovementSuggestions(payload.improvementSuggestions || []);
      setHighlights(payload.highlights || []);
      setChunkSummaries(payload.chunkSummaries || []);
      setMeta({
        file: payload.file,
        stats: payload.stats,
        summaryLength: payload.summaryLength,
        truncated: payload.truncated,
        chunkCount: payload.chunkCount,
      });
      if (payload.chunkCount > 1) {
        setStatus(`Processed in ${payload.chunkCount} chunks — final summary ready.`);
      } else {
        setStatus('Summary ready.');
      }
      setWaitingForGemini(false);
    } catch (e) {
      const friendly = e?.response?.data?.error || e.message;
      if (isGeminiRetryMessage(friendly)) {
        setWaitingForGemini(true);
        setStatus('Waiting for Gemini API quota...');
        setError('Gemini is temporarily overloaded or quota exceeded. Please wait, retrying automatically.');
      } else {
        setWaitingForGemini(false);
        setError(friendly);
        setStatus('');
      }
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSummary('');
    setKeyPoints([]);
    setImprovementSuggestions([]);
    setHighlights([]);
    setChunkSummaries([]);
    setMeta(null);
    setStatus('');
    setError(null);
    setWaitingForGemini(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="page summarizer">
      <div className="header">
        <div className="brand">
          <div className="logo">DS</div>
          <div>
            <div className="title">Document Summary Assistant</div>
            <div className="subtitle">Upload PDFs or images and get smart summaries</div>
          </div>
        </div>
      </div>

      <div className="layout">
        {/* Upload Card */}
        <div className="card uploader">
          <div
            className={`drop${hover ? ' hover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setHover(true); }}
            onDragLeave={() => setHover(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current.click()}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 140, borderRadius: 8 }} />
            ) : (
              <>
                <p style={{ fontWeight: 600 }}>Drag & drop a PDF or image here</p>
                <p style={{ color: '#9fb0c9', marginTop: 6 }}>or click to browse files</p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
          </div>

          {/* Controls */}
          <div className="controls">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ color: '#cfe7ff', fontWeight: 600 }}>Summary length</label>
              <select value={length} onChange={(e) => setLength(e.target.value)}>
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn secondary" onClick={clear}>Clear</button>
              <button className="btn" onClick={upload} disabled={loading}>
                {loading ? <span className="spinner" /> : 'Upload & Summarize'}
              </button>
            </div>
          </div>

          {file && (
            <div className="file-info" style={{ marginTop: 10 }}>
              <div className="file-name">{file.name}</div>
              <div style={{ color: '#9fb0c9', fontSize: 13 }}>{(file.size / 1024).toFixed(0)} KB</div>
            </div>
          )}
          {status && (
            <div className="status-banner">
              {status}
              {waitingForGemini && (
                <span style={{ color: '#ffe066', marginLeft: 8, fontWeight: 500 }}>
                  <span className="spinner" style={{ marginRight: 6 }} />
                  Waiting for Gemini API quota...
                </span>
              )}
            </div>
          )}
          {error && <div style={{ color: '#ffb4b4', marginTop: 8 }}>{error}</div>}
        </div>

        {/* Result Card */}
        <div className="card result-area">
          <div className="result-header">
            <h2>Summary</h2>
            {meta && meta.summaryLength && (
              <span className="chip">{meta.summaryLength} mode</span>
            )}
          </div>

          {loading && <div className="spinner" />}

          {!loading && !summary && (
            <p className="muted">Upload a document to see the AI summary.</p>
          )}

          {summary && (
            <div className="summary">
              {summary}
              {meta?.truncated && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Input text was truncated to keep the model within safe limits.
                </p>
              )}
            </div>
          )}

          {highlights.length > 0 && (
            <div className="section">
              <h3>Highlights</h3>
              <div className="highlight-grid">
                {highlights.map((line, idx) => (
                  <span className="chip soft" key={idx}>{line}</span>
                ))}
              </div>
            </div>
          )}

          {keyPoints.length > 0 && (
            <div className="section">
              <h3>Key Points</h3>
              <ul>
                {keyPoints.map((point, i) => <li key={i}>{point}</li>)}
              </ul>
            </div>
          )}

          {improvementSuggestions.length > 0 && (
            <div className="section">
              <h3>Improvement Suggestions</h3>
              <ol>
                {improvementSuggestions.map((suggestion, i) => (
                  <li key={i}>{suggestion}</li>
                ))}
              </ol>
            </div>
          )}

          {chunkSummaries.length > 0 && (
            <div className="section">
              <div className="section-header">
                <h3>Chunk Summaries</h3>
                <span className="chip soft">{chunkSummaries.length} parallel chunks</span>
              </div>
              <ol className="chunk-list">
                {chunkSummaries.map((chunk, idx) => (
                  <li key={idx}>
                    <strong>Chunk {idx + 1}:</strong> {chunk}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {meta && (
            <div className="section">
              <h3>Document Insights</h3>
              <div className="insights">
                <div>
                  <label>File</label>
                  <span>{meta.file?.name || '—'}</span>
                </div>
                <div>
                  <label>Size</label>
                  <span>
                    {meta.file?.size ? `${(meta.file.size / 1024).toFixed(0)} KB` : '—'}
                  </span>
                </div>
                <div>
                  <label>Extracted Characters</label>
                  <span>{meta.stats?.extractedCharacters?.toLocaleString() || '—'}</span>
                </div>
                <div>
                  <label>Summary Characters</label>
                  <span>{meta.stats?.summaryCharacters?.toLocaleString() || '—'}</span>
                </div>
                {meta.chunkCount && meta.chunkCount > 1 && (
                  <div>
                    <label>Chunks</label>
                    <span>{meta.chunkCount}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && summary && (
            <div className="section" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn secondary" onClick={() => inputRef.current?.click()}>Upload another document</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
