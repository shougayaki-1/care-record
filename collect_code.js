const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const options = {
        dryRun: false,
        maxFileSizeBytes: 200 * 1024,
        writeUnified: true,
    };

    argv.forEach(arg => {
        if (arg.startsWith('--max-file-size=')) {
            const rawValue = arg.split('=')[1];
            const parsedValue = Number(rawValue);
            if (Number.isFinite(parsedValue) && parsedValue > 0) {
                options.maxFileSizeBytes = parsedValue;
            }
        }

        if (arg === '--split-only') {
            options.writeUnified = false;
        }

        if (arg === '--dry-run') {
            options.dryRun = true;
        }
    });

    return options;
}

// ==========================================
// 1. 設定
// ==========================================

const options = parseArgs(process.argv.slice(2));

// 収集したいディレクトリ
const TARGET_DIRS = [
    'app',
    'src',
    'components',
    'lib',
    'utils',
    'hooks',
    'types',
    'interfaces',
    'prisma',
    'supabase',
    'actions', // Server Actionsなど
];

// 除外したいディレクトリ名
const IGNORE_DIR_NAMES = [
    'node_modules',
    '.next',
    '.git',
    '.temp',
    '.branches',
    '.vercel',
    'storybook-static',
    'ai_context_output',
    'coverage',
];

// 除外したいパス
const IGNORE_PATH_PARTS = [
    'supabase/migrations/old',
    'supabase/supabase',
];

// 除外したいファイル名や拡張子
const IGNORE_FILE_PATTERNS = [
    '.DS_Store',
    'favicon.ico',
    'package-lock.json',
    'yarn.lock',
    '.png', '.jpg', '.jpeg', '.svg', '.ico', '.gif', // 画像
    '.woff', '.woff2', '.ttf', // フォント
    'pdf-font.ts', // ★ここに追加しました
];

// 収集するテキスト系ファイル
const ALLOWED_EXTENSIONS = new Set([
    '.cjs',
    '.css',
    '.env',
    '.html',
    '.js',
    '.json',
    '.jsx',
    '.md',
    '.mjs',
    '.prisma',
    '.sql',
    '.toml',
    '.ts',
    '.tsx',
    '.txt',
    '.yml',
    '.yaml',
]);

// 出力先のベースディレクトリ
const BASE_OUTPUT_DIR = 'ai_context_output';
const SPLIT_DIR_NAME = 'split';   // 個別ファイルの保存先
const UNIFIED_DIR_NAME = 'unified'; // 統合ファイルの保存先
const UNIFIED_FILENAME = 'all_source_code.txt'; // 統合ファイル名

// ==========================================
// 2. 準備処理
// ==========================================

const splitDirPath = path.join(BASE_OUTPUT_DIR, SPLIT_DIR_NAME);
const unifiedDirPath = path.join(BASE_OUTPUT_DIR, UNIFIED_DIR_NAME);

if (!options.dryRun) {
    // 出力ディレクトリを初期化（あれば削除して作り直し）
    if (fs.existsSync(BASE_OUTPUT_DIR)) {
        fs.rmSync(BASE_OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(BASE_OUTPUT_DIR);
    fs.mkdirSync(splitDirPath);
    fs.mkdirSync(unifiedDirPath);
}

function normalizePath(filePath) {
    return filePath.split(path.sep).join('/');
}

function shouldIgnorePath(filePath, isDirectory = false) {
    const normalizedPath = normalizePath(filePath);
    const parts = normalizedPath.split('/');
    const baseName = path.basename(filePath);
    const extension = path.extname(baseName).toLowerCase();

    if (parts.some(part => IGNORE_DIR_NAMES.includes(part))) {
        return `ignored directory`;
    }

    if (IGNORE_PATH_PARTS.some(pattern => normalizedPath.includes(pattern))) {
        return `ignored path`;
    }

    if (isDirectory) {
        return null;
    }

    if (IGNORE_FILE_PATTERNS.some(pattern => baseName === pattern || extension === pattern)) {
        return `ignored file type`;
    }

    if (!ALLOWED_EXTENSIONS.has(extension)) {
        return `unsupported extension`;
    }

    return null;
}

// 再帰的にファイルを取得する関数
function getAllFiles(dirPath, arrayOfFiles, skippedFiles) {
    let files = [];
    try {
        files = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
        return [];
    }

    arrayOfFiles = arrayOfFiles || [];
    skippedFiles = skippedFiles || [];

    files.forEach(function (entry) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            const ignoreReason = shouldIgnorePath(fullPath, true);
            if (ignoreReason) {
                skippedFiles.push({ filePath: fullPath, reason: ignoreReason });
                return;
            }

            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles, skippedFiles);
            return;
        }

        const ignoreReason = shouldIgnorePath(fullPath);
        if (ignoreReason) {
            skippedFiles.push({ filePath: fullPath, reason: ignoreReason });
            return;
        }

        const stats = fs.statSync(fullPath);
        if (stats.size > options.maxFileSizeBytes) {
            skippedFiles.push({ filePath: fullPath, reason: `too large (${formatBytes(stats.size)})` });
            return;
        }

        arrayOfFiles.push({ filePath: fullPath, size: stats.size });
    });

    return arrayOfFiles;
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

// ==========================================
// 3. メイン処理
// ==========================================

console.log('📂 ファイルの収集と統合を開始します...');
console.log(`   最大ファイルサイズ: ${formatBytes(options.maxFileSizeBytes)}`);
if (options.dryRun) {
    console.log('   ドライラン: ファイルは書き出しません (--dry-run)');
}
if (!options.writeUnified) {
    console.log('   統合ファイル: 作成しません (--split-only)');
}

let count = 0;
let totalBytes = 0;
let unifiedContent = ""; // ここに全てのコードを結合していきます
const skippedFiles = [];

TARGET_DIRS.forEach(targetDir => {
    // ディレクトリが存在しない場合はスキップ
    if (!fs.existsSync(targetDir)) {
        return;
    }

    const allFiles = getAllFiles(targetDir, [], skippedFiles);

    allFiles.forEach(({ filePath, size }) => {
        try {
            const content = fs.readFileSync(filePath, 'utf8');

            // ------------------------------------------------
            // A. 分割ファイル作成 (個別ファイルとして保存)
            // ------------------------------------------------
            // パス区切り文字をアンダースコアに変換
            const flatName = filePath.split(path.sep).join('_') + '.txt';
            if (!options.dryRun) {
                fs.writeFileSync(path.join(splitDirPath, flatName), content);
            }

            // ------------------------------------------------
            // B. 統合テキスト作成 (変数に追加)
            // ------------------------------------------------
            // AIがファイル名を認識しやすいヘッダーをつける
            if (options.writeUnified) {
                unifiedContent += `\n--- START OF FILE ${filePath} ---\n\n`;
                unifiedContent += content;
                unifiedContent += `\n\n`; // ファイル間に空白を入れる
            }

            console.log(`✅ Copied: ${filePath}`);
            count++;
            totalBytes += size;

        } catch (err) {
            console.error(`❌ Error reading ${filePath}:`, err.message);
        }
    });
});

// ------------------------------------------------
// C. 統合ファイルの書き出し
// ------------------------------------------------
if (count > 0) {
    if (options.writeUnified) {
        const unifiedFilePath = path.join(unifiedDirPath, UNIFIED_FILENAME);
        if (!options.dryRun) {
            fs.writeFileSync(unifiedFilePath, unifiedContent);
        }
    }

    console.log(`\n🎉 完了しました！`);
    console.log(`📁 出力フォルダ: ${BASE_OUTPUT_DIR}`);
    console.log(`   ├─ 📂 ${SPLIT_DIR_NAME} (個別のテキストファイル: ${count}個)`);
    if (options.writeUnified) {
        console.log(`   └─ 📂 ${UNIFIED_DIR_NAME} (すべてまとめたファイル: ${UNIFIED_FILENAME})`);
        console.log(`\n📏 収集サイズ: ${formatBytes(totalBytes)} / 統合ファイル推定: 約 ${estimateTokens(unifiedContent).toLocaleString()} tokens`);
        console.log(`\n🤖 AIには '${path.join(UNIFIED_DIR_NAME, UNIFIED_FILENAME)}' をアップロードしてください。`);
    } else {
        console.log(`   └─ 📂 ${UNIFIED_DIR_NAME} (未作成)`);
        console.log(`\n📏 収集サイズ: ${formatBytes(totalBytes)}`);
    }

    if (skippedFiles.length > 0) {
        const skippedReportPath = path.join(BASE_OUTPUT_DIR, 'skipped_files.txt');
        const skippedReport = skippedFiles
            .map(({ filePath, reason }) => `${filePath}\t${reason}`)
            .join('\n');

        if (!options.dryRun) {
            fs.writeFileSync(skippedReportPath, skippedReport);
        }
        console.log(`🧹 除外: ${skippedFiles.length}件 (${options.dryRun ? 'ドライランのため未保存' : `${skippedReportPath} に一覧を保存`})`);
    }
} else {
    console.log('\n⚠️ 対象ファイルが見つかりませんでした。ディレクトリ設定を確認してください。');
}
