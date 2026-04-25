'use client';
import { Modal } from '@/components/ui/modal';
import { Button } from '../../ui/button';
import { NumberInput } from '../../ui/number-input';
import { TextInput } from '../../ui/text-input';
import { Switch } from '../../ui/switch';

export interface AdvancedVariables {
  regexScore: number | undefined;
  maxRegexScore: number | undefined;
  streamExpressionScore: number | undefined;
  maxSeScore: number | undefined;
  seMatched: string | undefined;
  rseMatched: string | undefined;
  rankedRegexMatched: string;
  seadex: boolean;
  seadexBest: boolean;
}

interface AdvancedModalProps extends AdvancedVariables {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setRegexScore: (v: number | undefined) => void;
  setMaxRegexScore: (v: number | undefined) => void;
  setStreamExpressionScore: (v: number | undefined) => void;
  setMaxSeScore: (v: number | undefined) => void;
  setSeMatched: (v: string | undefined) => void;
  setRseMatched: (v: string | undefined) => void;
  setRankedRegexMatched: (v: string) => void;
  setSeadex: (v: boolean) => void;
  setSeadexBest: (v: boolean) => void;
}

export function AdvancedModal({
  open,
  onOpenChange,
  regexScore,
  setRegexScore,
  maxRegexScore,
  setMaxRegexScore,
  streamExpressionScore,
  setStreamExpressionScore,
  maxSeScore,
  setMaxSeScore,
  seMatched,
  setSeMatched,
  rseMatched,
  setRseMatched,
  rankedRegexMatched,
  setRankedRegexMatched,
  seadex,
  setSeadex,
  seadexBest,
  setSeadexBest,
}: AdvancedModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Advanced Formatter Variables"
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-gray-300">
            Score Variables
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Regex Score"
              value={regexScore}
              onValueChange={setRegexScore}
              min={-1_000_000}
              max={1_000_000}
              step={5}
              placeholder="25"
            />
            <NumberInput
              label="Highest Regex Score"
              value={maxRegexScore}
              onValueChange={setMaxRegexScore}
              min={1}
              step={10}
              placeholder="50"
            />
            <NumberInput
              label="SE Score"
              value={streamExpressionScore}
              onValueChange={setStreamExpressionScore}
              min={-1_000_000}
              max={1_000_000}
              step={10}
              placeholder="150"
            />
            <NumberInput
              label="Highest SE Score"
              value={maxSeScore}
              onValueChange={setMaxSeScore}
              min={1}
              step={25}
              placeholder="200"
            />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-gray-300">
            Matched Variables
          </h3>
          <TextInput
            label="SE Matched"
            value={seMatched}
            onValueChange={setSeMatched}
            placeholder="e.g., 'high-quality'"
          />
          <TextInput
            label="Ranked SE Matched (comma-separated)"
            value={rseMatched}
            onValueChange={setRseMatched}
            placeholder="e.g., 'high-quality, best-match, another-match'"
          />
          <TextInput
            label="Ranked Regex Matched (comma-separated)"
            value={rankedRegexMatched}
            onValueChange={setRankedRegexMatched}
            placeholder="e.g., '2160p, HDR10+, REMUX'"
          />
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-gray-300">
            SeaDex Variables
          </h3>
          <div className="flex gap-4 justify-center">
            <Switch label="SeaDex" value={seadex} onValueChange={setSeadex} />
            <Switch
              label="SeaDex Best"
              value={seadex ? seadexBest : false}
              disabled={!seadex}
              onValueChange={setSeadexBest}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button intent="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
