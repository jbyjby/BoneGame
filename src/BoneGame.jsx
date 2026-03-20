import { useEffect, useRef, useState, useCallback } from 'react'
import './BoneGame.css'

// 뼈 파일 목록
const FILES = [
  '1.png','2.png','3.png','4.png','5.png',
  '6.png','7.png','8.png','9.png','10.png',
  '11.png','12.png','13.png','14.png','15.png',
]

const TARGET_MAX = 180  // 가장 큰 뼈 기준 최대 표시 크기
const MARGIN     = 20   // 화면 밖으로 못 나가는 여백

// ── 배경 제거 ──────────────────────────────────────────────────────────────
function removeBg(img) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height)
  const px = d.data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i+1], b = px[i+2]
    const brightness = (r + g + b) / 3
    const max = Math.max(r, g, b)
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max
    if (brightness > 175 && sat < 0.25) px[i+3] = 0
  }
  ctx.putImageData(d, 0, 0)
  return c
}

// ── bounding-box 자동 크롭 ─────────────────────────────────────────────────
function autoCrop(c) {
  const ctx = c.getContext('2d')
  const { width: w, height: h } = c
  const px = ctx.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;  if (x > x1) x1 = x
        if (y < y0) y0 = y;  if (y > y1) y1 = y
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return c
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  const out = document.createElement('canvas')
  out.width = cw; out.height = ch
  out.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch)
  return out
}

function canvasToUrl(c) { return c.toDataURL('image/png') }

// ── 경계 클램프 ───────────────────────────────────────────────────────────
function clamp(val, min, max) { return Math.min(Math.max(val, min), max) }

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export default function BoneGame() {
  const [bones, setBones]       = useState([])
  const [loaded, setLoaded]     = useState(false)
  const [selectedBone, setSelectedBone] = useState(null)
  const [showAnswer, setShowAnswer]     = useState(false)

  const dragRef  = useRef(null)
  const rotRef   = useRef(null)
  const bonesRef = useRef([])
  const imgUrls  = useRef({})

  useEffect(() => { bonesRef.current = bones }, [bones])

  // ── 이미지 로드 & 처리 ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      const results = await Promise.all(
        FILES.map((f, idx) => new Promise(resolve => {
          const img = new Image()
          img.onload = () => {
            const cropped = autoCrop(removeBg(img))
            resolve({ idx, w: cropped.width, h: cropped.height, canvas: cropped })
          }
          img.onerror = () => resolve({ idx, w: 10, h: 10, canvas: document.createElement('canvas') })
          img.src = `${import.meta.env.BASE_URL}bones/${f}`
        }))
      )
      if (cancelled) return

      const globalMax = Math.max(...results.map(r => Math.max(r.w, r.h)))
      const scale = TARGET_MAX / globalMax

      results.forEach(r => { imgUrls.current[r.idx] = canvasToUrl(r.canvas) })

      setBones(makeLayout(results, scale, window.innerWidth, window.innerHeight))
      setLoaded(true)
    }
    loadAll()
    return () => { cancelled = true }
  }, [])

  // ── 랜덤 배치 ─────────────────────────────────────────────────────────
  function makeLayout(results, scale, vw, vh) {
    const cols = 5, rows = 3
    const cellW = vw / cols, cellH = vh / rows
    const shuffled = [...Array(results.length).keys()].sort(() => Math.random() - 0.5)
    return results.map((r, i) => {
      const pos = shuffled[i]
      const col = pos % cols, row = Math.floor(pos / cols)
      const dispW = r.w * scale, dispH = r.h * scale
      const x = clamp(
        cellW * col + cellW * 0.15 + Math.random() * cellW * 0.7,
        dispW / 2 + MARGIN, vw - dispW / 2 - MARGIN
      )
      const y = clamp(
        cellH * row + cellH * 0.15 + Math.random() * cellH * 0.7,
        dispH / 2 + MARGIN, vh - dispH / 2 - MARGIN
      )
      return { boneIdx: r.idx, x, y, rot: Math.random() * 360 - 180, scale, dispW, dispH, zIndex: i + 10 }
    })
  }

  // ── 드래그 시작 ───────────────────────────────────────────────────────
  const onMouseDown = useCallback((e, boneIdx) => {
    e.preventDefault(); e.stopPropagation()
    const pt = e.touches ? e.touches[0] : e
    const b  = bonesRef.current.find(b => b.boneIdx === boneIdx)
    dragRef.current = { boneIdx, ox: pt.clientX - b.x, oy: pt.clientY - b.y }
    setSelectedBone(boneIdx)
    setBones(prev => {
      const maxZ = Math.max(...prev.map(b => b.zIndex))
      return prev.map(b => b.boneIdx === boneIdx ? { ...b, zIndex: maxZ + 1 } : b)
    })
  }, [])

  // ── 회전 핸들 시작 ────────────────────────────────────────────────────
  const onRotateStart = useCallback((e, boneIdx) => {
    e.preventDefault(); e.stopPropagation()
    const pt = e.touches ? e.touches[0] : e
    const b  = bonesRef.current.find(b => b.boneIdx === boneIdx)
    const startAngle = Math.atan2(pt.clientY - b.y, pt.clientX - b.x) * 180 / Math.PI
    rotRef.current = { boneIdx, startAngle, boneAngle: b.rot }
  }, [])

  // ── 이동 ─────────────────────────────────────────────────────────────
  const onMove = useCallback((e) => {
    const pt = e.touches ? e.touches[0] : e
    if (dragRef.current) {
      const { boneIdx, ox, oy } = dragRef.current
      setBones(prev => prev.map(b => {
        if (b.boneIdx !== boneIdx) return b
        // 화면 밖으로 못 나가게 클램프
        const half = Math.max(b.dispW, b.dispH) / 2
        const nx = clamp(pt.clientX - ox, MARGIN + half, window.innerWidth  - MARGIN - half)
        const ny = clamp(pt.clientY - oy, MARGIN + half, window.innerHeight - MARGIN - half)
        return { ...b, x: nx, y: ny }
      }))
    }
    if (rotRef.current) {
      const { boneIdx, startAngle, boneAngle } = rotRef.current
      const b = bonesRef.current.find(b => b.boneIdx === boneIdx)
      const cur = Math.atan2(pt.clientY - b.y, pt.clientX - b.x) * 180 / Math.PI
      setBones(prev => prev.map(b => b.boneIdx === boneIdx ? { ...b, rot: boneAngle + (cur - startAngle) } : b))
    }
  }, [])

  // ── 끝 ───────────────────────────────────────────────────────────────
  const onUp = useCallback(() => {
    dragRef.current = null
    rotRef.current  = null
  }, [])

  // ── 리셋 ─────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setSelectedBone(null)
    setBones(prev => {
      const scale = prev[0]?.scale ?? 1
      const results = prev.map(b => ({ idx: b.boneIdx, w: b.dispW / scale, h: b.dispH / scale }))
      return makeLayout(results, scale, window.innerWidth, window.innerHeight)
    })
  }, [])

  if (!loaded) {
    return (
      <div className="loading">
        <div className="loading-inner">
          <div className="dino-icon">🦕</div>
          <p>화석 발굴 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="game-container"
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseDown={() => setSelectedBone(null)}
      onTouchMove={onMove}
      onTouchEnd={onUp}
    >
      {[...bones].sort((a, b) => a.zIndex - b.zIndex).map(b => {
        const isSelected = selectedBone === b.boneIdx
        // 긴 변(긴 쪽 엣지)의 중간에 회전버튼 배치
        // 가로 긴 뼈: 긴 변 = 위/아래 → 아래쪽 중앙
        // 세로 긴 뼈: 긴 변 = 좌/우  → 오른쪽 중앙
        const isWide = b.dispW >= b.dispH
        const rotHandleStyle = isWide
          ? { bottom: -24, left: '50%', transform: 'translateX(-50%)' } // 가로 긴 뼈 → 아래쪽 중앙
          : { right: -24, top: '50%',  transform: 'translateY(-50%)' }  // 세로 긴 뼈 → 오른쪽 중앙

        return (
          <div
            key={b.boneIdx}
            className={`bone-piece${isSelected ? ' bone-selected' : ''}`}
            style={{
              left: b.x, top: b.y,
              width: b.dispW, height: b.dispH,
              transform: `translate(-50%,-50%) rotate(${b.rot}deg)`,
              zIndex: b.zIndex,
              cursor: 'grab',
            }}
            onMouseDown={e => onMouseDown(e, b.boneIdx)}
            onTouchStart={e => onMouseDown(e, b.boneIdx)}
          >
            <img
              src={imgUrls.current[b.boneIdx]}
              style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
              draggable={false}
            />
            {isSelected && (
              <div
                className="rotate-handle"
                style={{ position: 'absolute', ...rotHandleStyle }}
                onMouseDown={e => onRotateStart(e, b.boneIdx)}
                onTouchStart={e => onRotateStart(e, b.boneIdx)}
                title="드래그하여 회전"
              >↻</div>
            )}
          </div>
        )
      })}

      {/* UI 패널 */}
      <div className="ui-panel">
        <div className="ui-title">🦖 공룡 뼈 맞추기</div>
        <button className="ui-btn" onClick={reset}>🔄 다시 시작</button>
        <button className="ui-btn answer-btn" onClick={() => setShowAnswer(true)}>🦴 정답 보기</button>
      </div>

      {/* 정답 이미지 모달 */}
      {showAnswer && (
        <div className="answer-overlay" onClick={() => setShowAnswer(false)}>
          <div className="answer-box" onClick={e => e.stopPropagation()}>
            <div className="answer-header">
              <span>정답 골격</span>
              <button className="answer-close" onClick={() => setShowAnswer(false)}>✕</button>
            </div>
            <img src={`${import.meta.env.BASE_URL}reference.png`} alt="정답 골격" className="answer-img" />
          </div>
        </div>
      )}
    </div>
  )
}
