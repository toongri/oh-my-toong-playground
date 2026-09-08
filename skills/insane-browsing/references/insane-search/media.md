# Media Extraction — yt-dlp

> yt-dlp is a general media extraction tool supporting **1,858 sites**, not just YouTube.
> Video, audio, podcasts, live streaming — try yt-dlp first for media URLs.

## Check Installation

```bash
which yt-dlp || python3 -m yt_dlp --version
```

- Use `yt-dlp` directly if the command is on PATH
- Otherwise, substitute `python3 -m yt_dlp` (in all commands below)
- If not installed: `pip install yt-dlp`

## Core Commands (All Supported Sites)

### Metadata Extraction (Most General)

```bash
yt-dlp --dump-json "URL"
```

Returns structured JSON including title, uploader, duration, view_count, description, and tags.
Approximately 95% success on sites with a dedicated extractor.

### Subtitle Extraction

```bash
yt-dlp --write-sub --write-auto-sub --sub-lang "en,ko" --skip-download -o "/tmp/%(id)s" "URL"
cat /tmp/VIDEO_ID.*.vtt
```

YouTube supports automatic captions in 100 languages. Other sites work only when they provide their own subtitles.

### Search

```bash
# YouTube
yt-dlp --dump-json "ytsearch5:{검색어}"

# SoundCloud
yt-dlp --dump-json "scsearch5:{검색어}"

# Dailymotion
yt-dlp --dump-json "dailymotionsearch5:{검색어}"

# Yahoo
yt-dlp --dump-json "yahoosearch5:{검색어}"
```

### Channel/Playlist Listings (Without Downloading)

```bash
yt-dlp --flat-playlist --dump-json "채널_URL"
```

Returns title, id, url, and duration. Collect the channel's full video listing very quickly.

### Comment Extraction (YouTube)

```bash
yt-dlp --write-comments --skip-download --write-info-json \
  --extractor-args "youtube:max_comments=20" \
  -o "/tmp/%(id)s" "URL"
```

## Supported Platform Categories

### Video

| Site | Metadata | Subtitles | Search | Notes |
|--------|----------|------|------|------|
| YouTube | O | O (including auto-generated) | `ytsearch` | Best support |
| Vimeo | O | O (when provided by the site) | X | Rich academic/documentary content |
| Twitch | O (VOD/clips) | X | X | Technology streaming |
| TikTok | O | X | X | Public accounts only |
| Dailymotion | O | O | `dailymotionsearch` | |
| Rumble | O | X | X | |
| PeerTube | O | X | X | Decentralized |

### Audio/Podcasts

| Site | Metadata | Search | Notes |
|--------|----------|------|------|
| SoundCloud | O | `scsearch` | Search supported too — best |
| Apple Podcasts | O | X | RSS-based |
| TuneIn | O | X | |
| acast | O | X | Channel-level support |
| Spreaker | O | X | |
| Audius | O | X | Blockchain-based |

### Korean Platforms

| Site | Extractor | Notes |
|--------|-----------|------|
| Naver TV | `Naver`, `Naver:live` | |
| Kakao | `Kakao` | |
| SBS | `SBS`, `sbs.co.kr` | |
| JTBC | `JTBC`, `JTBC:program` | |
| Chzzk | `chzzk:video`, `chzzk:live` | Naver streaming |
| Soop (formerly AfreecaTV) | `soop`, `soop:live` | |
| Daum | `daum.net`, `daum.net:clip` | |
| Weverse | `Weverse`, `WeverseLive` | K-pop fandom |

### News VOD

| Site | Notes |
|--------|------|
| BBC | Public VOD |
| ABC (Australia) | iview |
| CBS News | |
| NBC News | Frequently blocked |

> For news sites, **going through their official YouTube channels** is more reliable than direct URLs.
> Example: `ytsearch:BBC News {키워드}`

## Cautions

- Auto-generated subtitles duplicate text between lines → post-processing required
- The generic extractor has ~30% success — prioritize sites with dedicated extractors
- Most paywalled/login-required sites fail
- `--dump-json` is the safest general command (no download, metadata only)
