const fs = require('fs');
const path = require('path');

// ==========================================
// 1. 設定
// ==========================================

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

// 除外したいファイルやディレクトリ
const IGNORE_PATTERNS = [
    'node_modules',
    '.next',
    '.git',
    '.DS_Store',
    'favicon.ico',
    'package-lock.json',
    'yarn.lock',
    '.png', '.jpg', '.jpeg', '.svg', '.ico', '.gif', // 画像
    '.woff', '.woff2', '.ttf', // フォント
    'pdf-font.ts', // ★ここに追加しました
];

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

// 出力ディレクトリを初期化（あれば削除して作り直し）
if (fs.existsSync(BASE_OUTPUT_DIR)) {
    fs.rmSync(BASE_OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BASE_OUTPUT_DIR);
fs.mkdirSync(splitDirPath);
fs.mkdirSync(unifiedDirPath);

// 再帰的にファイルを取得する関数
function getAllFiles(dirPath, arrayOfFiles) {
    let files = [];
    try {
        files = fs.readdirSync(dirPath);
    } catch (e) {
        return [];
    }

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        const fullPath = path.join(dirPath, file);

        // 除外パターンに含まれるかチェック
        if (IGNORE_PATTERNS.some(pattern => fullPath.includes(pattern))) {
            return;
        }

        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

// ==========================================
// 3. メイン処理
// ==========================================

console.log('📂 ファイルの収集と統合を開始します...');

let count = 0;
let unifiedContent = ""; // ここに全てのコードを結合していきます

TARGET_DIRS.forEach(targetDir => {
    // ディレクトリが存在しない場合はスキップ
    if (!fs.existsSync(targetDir)) {
        return;
    }

    const allFiles = getAllFiles(targetDir);

    allFiles.forEach(filePath => {
        try {
            const content = fs.readFileSync(filePath, 'utf8');

            // ------------------------------------------------
            // A. 分割ファイル作成 (個別ファイルとして保存)
            // ------------------------------------------------
            // パス区切り文字をアンダースコアに変換
            const flatName = filePath.split(path.sep).join('_') + '.txt';
            fs.writeFileSync(path.join(splitDirPath, flatName), content);

            // ------------------------------------------------
            // B. 統合テキスト作成 (変数に追加)
            // ------------------------------------------------
            // AIがファイル名を認識しやすいヘッダーをつける
            unifiedContent += `\n--- START OF FILE ${filePath} ---\n\n`;
            unifiedContent += content;
            unifiedContent += `\n\n`; // ファイル間に空白を入れる

            console.log(`✅ Copied: ${filePath}`);
            count++;

        } catch (err) {
            console.error(`❌ Error reading ${filePath}:`, err.message);
        }
    });
});

// ------------------------------------------------
// C. 統合ファイルの書き出し
// ------------------------------------------------
if (count > 0) {
    const unifiedFilePath = path.join(unifiedDirPath, UNIFIED_FILENAME);
    fs.writeFileSync(unifiedFilePath, unifiedContent);

    console.log(`\n🎉 完了しました！`);
    console.log(`📁 出力フォルダ: ${BASE_OUTPUT_DIR}`);
    console.log(`   ├─ 📂 ${SPLIT_DIR_NAME} (個別のテキストファイル: ${count}個)`);
    console.log(`   └─ 📂 ${UNIFIED_DIR_NAME} (すべてまとめたファイル: ${UNIFIED_FILENAME})`);
    console.log(`\n🤖 AIには '${path.join(UNIFIED_DIR_NAME, UNIFIED_FILENAME)}' をアップロードしてください。`);
} else {
    console.log('\n⚠️ 対象ファイルが見つかりませんでした。ディレクトリ設定を確認してください。');
}