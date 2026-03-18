'use client';
import { useState } from 'react';
import { Template } from '@aiostreams/core';
import { TemplateValidation } from '@/lib/templates/types';

export interface ValidationModalState {
  show: boolean;
  template: Template | null;
  data: TemplateValidation | null;
  onProceed: (() => void) | null;
  proceedLabel: string;
}

export interface UseValidationModal extends ValidationModalState {
  open(params: {
    template: Template;
    data: TemplateValidation;
    onProceed: (() => void) | null;
    proceedLabel: string;
  }): void;
  close(): void;
  /** Replace only the onProceed callback (used when wrapping callbacks). */
  setOnProceed: React.Dispatch<React.SetStateAction<(() => void) | null>>;
}

export function useValidationModal(): UseValidationModal {
  const [show, setShow] = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);
  const [data, setData] = useState<TemplateValidation | null>(null);
  const [onProceed, setOnProceed] = useState<(() => void) | null>(null);
  const [proceedLabel, setProceedLabel] = useState<string>('Proceed');

  const open = ({
    template: t,
    data: d,
    onProceed: cb,
    proceedLabel: label,
  }: {
    template: Template;
    data: TemplateValidation;
    onProceed: (() => void) | null;
    proceedLabel: string;
  }) => {
    setTemplate(t);
    setData(d);
    setOnProceed(() => cb);
    setProceedLabel(label);
    setShow(true);
  };

  const close = () => {
    setShow(false);
    setTemplate(null);
    setData(null);
    setOnProceed(null);
    setProceedLabel('Proceed');
  };

  return { show, template, data, onProceed, proceedLabel, open, close, setOnProceed };
}
