export interface LineDiff {
  type: 'same' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  truncated?: boolean;
}

export function calculateLineDiff(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Safety check
  if (oldLines.length * newLines.length > 2500000) { // 1500 x 1500 lines
      return [
          { type: 'remove', content: oldText, oldLineNumber: 1, truncated: true },
          { type: 'add', content: newText, newLineNumber: 1, truncated: true }
      ];
  }

  return computeDiff(oldLines, newLines);
}

function computeDiff(oldLines: string[], newLines: string[]): LineDiff[] {
    const N = oldLines.length;
    const M = newLines.length;
    
    const dp: number[][] = Array(N + 1).fill(0).map(() => Array(M + 1).fill(0));
    
    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    
    const diff: LineDiff[] = [];
    let i = N;
    let j = M;
    
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            diff.unshift({ 
                type: 'same', 
                content: oldLines[i - 1],
                oldLineNumber: i,
                newLineNumber: j
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diff.unshift({ 
                type: 'add', 
                content: newLines[j - 1],
                newLineNumber: j
            });
            j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
            diff.unshift({ 
                type: 'remove', 
                content: oldLines[i - 1],
                oldLineNumber: i
            });
            i--;
        }
    }
    
    return diff;
}


