'use client';
import { useEffect, useRef, useState } from 'react';
import { PageWrapper } from '../../shared/page-wrapper';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { SettingsNavCard } from '../../shared/settings-card';
import { useUserData } from '@/context/userData';
import {
  FaBolt,
  FaClock,
  FaFilm,
  FaLanguage,
  FaEquals,
  FaTachometerAlt,
  FaRegCopy,
} from 'react-icons/fa';
import { FaTextSlash } from 'react-icons/fa6';
import {
  MdCleaningServices,
  MdHdrOn,
  MdMovieFilter,
  MdPerson,
  MdSurroundSound,
  MdTextFields,
  MdVideoLibrary,
  MdMiscellaneousServices,
} from 'react-icons/md';
import { BiSolidCameraMovie } from 'react-icons/bi';
import { BsRegex, BsSpeakerFill } from 'react-icons/bs';
import { GoContainer, GoFileBinary } from 'react-icons/go';
import { TbFilterCode } from 'react-icons/tb';
import { Select } from '../../ui/select';
import { Combobox } from '../../ui/combobox';
import { SettingsCard } from '../../shared/settings-card';
import {
  RESOLUTIONS,
  QUALITIES,
  ENCODES,
  STREAM_TYPES,
  VISUAL_TAGS,
  AUDIO_TAGS,
  LANGUAGES,
  TYPES,
  DEDUPLICATOR_KEYS,
  AUDIO_CHANNELS,
  MIN_SIZE,
  MAX_SIZE,
  MIN_SEEDERS,
  MAX_SEEDERS,
  MIN_AGE_HOURS,
  MAX_AGE_HOURS,
  MIN_BITRATE,
  MAX_BITRATE,
} from '../../../../../core/src/utils/constants';
import { Switch } from '../../ui/switch';
import { useStatus } from '@/context/status';
import { NumberInput } from '../../ui/number-input';
import { IconButton, Button } from '../../ui/button';
import { Tooltip } from '../../ui/tooltip';
import { Alert } from '../../ui/alert';
import { Modal } from '../../ui/modal';
import { useDisclosure } from '@/hooks/disclosure';
import { Slider } from '../../ui/slider/slider';
import MarkdownLite from '../../shared/markdown-lite';
import { useMode } from '@/context/mode';
import { copyToClipboard } from '@/utils/clipboard';

import { FilterSettings } from './_components/filter-settings';
import {
  TextInputs,
  ToggleableTextInputs,
  TwoTextInputs,
  RankedExpressionInputs,
  RankedRegexInputs,
} from './_components/filter-inputs';
import {
  SizeRangeSlider,
  BitrateRangeSlider,
} from './_components/range-sliders';
import {
  type Resolution,
  type Quality,
  type Encode,
  type StreamType,
  type VisualTag,
  type AudioTag,
  type AudioChannel,
  type Language,
  defaultPreferredResolutions,
  defaultPreferredQualities,
  defaultPreferredEncodes,
  defaultPreferredStreamTypes,
  defaultPreferredVisualTags,
  defaultPreferredAudioTags,
  tabsRootClass,
  tabsTriggerClass,
  tabsListClass,
  tabsContentClass,
  formatAgeDisplay,
  HeadingWithPageControls,
  deduplicatorMultiGroupBehaviourHelp,
  defaultDeduplicatorMultiGroupBehaviour,
} from './_components/filter-utils';
import type { SyncConfig } from './_components/synced-patterns';

export function FiltersMenu() {
  return (
    <>
      <PageWrapper className="p-4 sm:p-8 space-y-4">
        <Content />
      </PageWrapper>
    </>
  );
}

function Content() {
  const [tab, setTab] = useState('cache');
  const { status } = useStatus();
  const previousTab = useRef(tab);
  const { userData, setUserData } = useUserData();
  const allowedRegexModal = useDisclosure(false);
  const allowedRegexUrlsModal = useDisclosure(false);
  const whitelistedSelUrlsModal = useDisclosure(false);
  const { mode } = useMode();
  useEffect(() => {
    if (tab !== previousTab.current) {
      previousTab.current = tab;
    }
  }, [tab]);

  const getSyncedProps = (
    key:
      | 'syncedPreferredRegexUrls'
      | 'syncedExcludedRegexUrls'
      | 'syncedIncludedRegexUrls'
      | 'syncedRequiredRegexUrls'
      | 'syncedPreferredStreamExpressionUrls'
      | 'syncedExcludedStreamExpressionUrls'
      | 'syncedIncludedStreamExpressionUrls'
      | 'syncedRequiredStreamExpressionUrls'
      | 'syncedRankedStreamExpressionUrls'
  ): { syncConfig: SyncConfig } => ({
    syncConfig: {
      urls: userData[key] || [],
      trusted: userData.trusted,
      syncMode: key.includes('StreamExpression') ? 'sel' : 'regex',
      onUrlsChange: (urls: string[]) => {
        setUserData((prev) => ({
          ...prev,
          [key]: urls,
        }));
      },
    },
  });

  useEffect(() => {
    // set default preferred filters if they are undefined
    if (!userData.preferredResolutions) {
      setUserData((prev) => ({
        ...prev,
        preferredResolutions: defaultPreferredResolutions,
      }));
    }
    if (!userData.preferredQualities) {
      setUserData((prev) => ({
        ...prev,
        preferredQualities: defaultPreferredQualities,
      }));
    }
    if (!userData.preferredEncodes) {
      setUserData((prev) => ({
        ...prev,
        preferredEncodes: defaultPreferredEncodes,
      }));
    }
    if (!userData.preferredStreamTypes) {
      setUserData((prev) => ({
        ...prev,
        preferredStreamTypes: defaultPreferredStreamTypes,
      }));
    }
    if (!userData.preferredVisualTags) {
      setUserData((prev) => ({
        ...prev,
        preferredVisualTags: defaultPreferredVisualTags,
      }));
    }
    if (!userData.preferredAudioTags) {
      setUserData((prev) => ({
        ...prev,
        preferredAudioTags: defaultPreferredAudioTags,
      }));
    }
  }, []);
  return (
    <>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className={tabsRootClass}
        triggerClass={tabsTriggerClass}
        listClass={tabsListClass}
        contentClass={tabsContentClass}
      >
        <TabsList className="flex-wrap max-w-full lg:space-y-2">
          <SettingsNavCard>
            <div className="flex flex-col gap-4 md:flex-row justify-between items-center">
              <div className="space-y-1 my-2 px-2">
                <h4 className="text-center md:text-left">Filters</h4>
              </div>
              <div></div>
            </div>

            <div className="overflow-x-none overflow-y-scroll lg:overflow-y-hidden h-40 lg:h-auto rounded-[--radius-md] border lg:border-none [--webkit-overflow-scrolling:touch]">
              <TabsTrigger value="cache">
                <FaBolt className="text-lg mr-3" />
                Cache
              </TabsTrigger>

              <>
                <TabsTrigger value="resolution">
                  <BiSolidCameraMovie className="text-lg mr-3" />
                  Resolution
                </TabsTrigger>
              </>

              {mode == 'pro' && (
                <>
                  <TabsTrigger value="quality">
                    <MdMovieFilter className="text-lg mr-3" />
                    Quality
                  </TabsTrigger>
                </>
              )}
              {mode === 'pro' && (
                <>
                  <TabsTrigger value="encode">
                    <FaFilm className="text-lg mr-3" />
                    Encode
                  </TabsTrigger>
                </>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="stream-type">
                  <MdVideoLibrary className="text-lg mr-3" />
                  Stream Type
                </TabsTrigger>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="visual-tag">
                  <MdHdrOn className="text-lg mr-3" />
                  Visual Tag
                </TabsTrigger>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="audio-tag">
                  <BsSpeakerFill className="text-lg mr-3" />
                  Audio Tag
                </TabsTrigger>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="audio-channel">
                  <MdSurroundSound className="text-lg mr-3" />
                  Audio Channel
                </TabsTrigger>
              )}
              <TabsTrigger value="language">
                <FaLanguage className="text-lg mr-3" />
                Language
              </TabsTrigger>
              <TabsTrigger value="seeders">
                <MdPerson className="text-lg mr-3" />
                Seeders
              </TabsTrigger>
              <TabsTrigger value="age">
                <FaClock className="text-lg mr-3" />
                Age
              </TabsTrigger>
              {mode === 'pro' && (
                <>
                  <TabsTrigger value="title-matching">
                    <FaEquals className="text-lg mr-3" />
                    Matching
                  </TabsTrigger>
                </>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="keyword">
                  <MdTextFields className="text-lg mr-3" />
                  Keyword
                </TabsTrigger>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="release-group">
                  <FaTextSlash className="text-lg mr-3" />
                  Release Group
                </TabsTrigger>
              )}
              {mode === 'pro' && (
                <TabsTrigger value="stream-expression">
                  <TbFilterCode className="text-lg mr-3" />
                  Stream Expression
                </TabsTrigger>
              )}
              {(status?.settings.regexFilterAccess !== 'none' ||
                status?.settings.allowedRegexPatterns) &&
                mode === 'pro' && (
                  <TabsTrigger value="regex">
                    <BsRegex className="text-lg mr-3" />
                    Regex
                  </TabsTrigger>
                )}
              <TabsTrigger value="size">
                <GoFileBinary className="text-lg mr-3" />
                Size
              </TabsTrigger>
              <TabsTrigger value="bitrate">
                <FaTachometerAlt className="text-lg mr-3" />
                Bitrate
              </TabsTrigger>
              <TabsTrigger value="limit">
                <GoContainer className="text-lg mr-3" />
                Result Limits
              </TabsTrigger>
              <TabsTrigger value="deduplicator">
                <MdCleaningServices className="text-lg mr-3" />
                Deduplicator
              </TabsTrigger>
              <TabsTrigger value="miscellaneous">
                <MdMiscellaneousServices className="text-lg mr-3" />
                Miscellaneous
              </TabsTrigger>
            </div>
          </SettingsNavCard>
        </TabsList>

        <div className="space-y-0 relative">
          <TabsContent value="cache" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Cache" />
              <div className="space-y-4">
                <SettingsCard
                  title="Uncached"
                  description="Control the exclusion of uncached results"
                >
                  <div className="space-y-4">
                    <Switch
                      label="Exclude Uncached"
                      help="Completely remove uncached results"
                      moreHelp="Enabling this option overrides the below controls and cannot be used in conjunction with them"
                      side="right"
                      value={userData.excludeUncached ?? false}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          excludeUncached: value,
                        }));
                      }}
                    />
                    {mode === 'pro' && (
                      <>
                        <Combobox
                          help="Addons selected here will have their uncached results excluded"
                          label="Exclude Uncached From Addons"
                          value={userData.excludeUncachedFromAddons ?? []}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeUncachedFromAddons: value,
                            }));
                          }}
                          options={userData.presets.map((preset) => ({
                            label: preset.options.name || preset.type,
                            value: preset.instanceId,
                            textValue: preset.options.name,
                          }))}
                          emptyMessage="You haven't installed any addons..."
                          placeholder="Select addons..."
                          multiple
                          disabled={userData.excludeUncached === true}
                        />

                        <Combobox
                          help="Services selected here will have their uncached results excluded"
                          label="Exclude Uncached From Services"
                          value={userData.excludeUncachedFromServices ?? []}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeUncachedFromServices: value,
                            }));
                          }}
                          options={Object.values(
                            status?.settings.services ?? {}
                          ).map((service) => ({
                            label: service.name,
                            value: service.id,
                            textValue: service.name,
                          }))}
                          placeholder="Select services..."
                          emptyMessage="This is odd... there aren't any services to choose from..."
                          multiple
                          disabled={userData.excludeUncached === true}
                        />
                        <Combobox
                          help="Stream types selected here will have their uncached results excluded"
                          label="Exclude Uncached From Stream Types"
                          value={userData.excludeUncachedFromStreamTypes ?? []}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeUncachedFromStreamTypes:
                                value as StreamType[],
                            }));
                          }}
                          options={STREAM_TYPES.filter((streamType) =>
                            ['debrid', 'usenet'].includes(streamType)
                          ).map((streamType) => ({
                            label: streamType,
                            value: streamType,
                            textValue: streamType,
                          }))}
                          emptyMessage="This is odd... there aren't any stream types to choose from..."
                          placeholder="Select stream types..."
                          multiple
                          disabled={userData.excludeUncached === true}
                        />

                        <Select
                          label="Apply mode"
                          disabled={userData.excludeUncached === true}
                          help="How these three options (from addons, services and stream types) are applied. AND means a result must match all, OR means a result only needs to match one"
                          value={userData.excludeUncachedMode ?? 'or'}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeUncachedMode: value as 'or' | 'and',
                            }));
                          }}
                          options={[
                            { label: 'OR', value: 'or' },
                            { label: 'AND', value: 'and' },
                          ]}
                        />
                      </>
                    )}
                  </div>
                </SettingsCard>
                <SettingsCard
                  title="Cached"
                  description="Control the exclusion of cached results"
                >
                  <div className="space-y-4">
                    <Switch
                      label="Exclude Cached"
                      help="Completely remove cached results"
                      moreHelp="Enabling this option overrides the below controls and cannot be used in conjunction with them"
                      side="right"
                      value={userData.excludeCached ?? false}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          excludeCached: value,
                        }));
                      }}
                    />
                    {mode === 'pro' && (
                      <>
                        <Combobox
                          help="Addons selected here will have their cached results excluded"
                          label="Exclude Cached From Addons"
                          value={userData.excludeCachedFromAddons ?? []}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeCachedFromAddons: value,
                            }));
                          }}
                          options={userData.presets.map((preset) => ({
                            label: preset.options.name || preset.type,
                            value: preset.instanceId,
                            textValue: preset.options.name || preset.type,
                          }))}
                          emptyMessage="You haven't installed any addons..."
                          placeholder="Select addons..."
                          multiple
                          disabled={userData.excludeCached === true}
                        />
                        <Combobox
                          help="Services selected here will have their cached results excluded"
                          label="Exclude Cached From Services"
                          value={userData.excludeCachedFromServices ?? []}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeCachedFromServices: value,
                            }));
                          }}
                          options={Object.values(
                            status?.settings.services ?? {}
                          ).map((service) => ({
                            label: service.name,
                            value: service.id,
                            textValue: service.name,
                          }))}
                          placeholder="Select services..."
                          emptyMessage="This is odd... there aren't any services to choose from..."
                          multiple
                          disabled={userData.excludeCached === true}
                        />
                        <Combobox
                          help="Stream types selected here will have their cached results excluded"
                          label="Exclude Cached From Stream Types"
                          value={userData.excludeCachedFromStreamTypes ?? []}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeCachedFromStreamTypes:
                                value as StreamType[],
                            }));
                          }}
                          options={STREAM_TYPES.filter((streamType) =>
                            ['debrid', 'usenet'].includes(streamType)
                          ).map((streamType) => ({
                            label: streamType,
                            value: streamType,
                            textValue: streamType,
                          }))}
                          emptyMessage="This is odd... there aren't any stream types to choose from..."
                          placeholder="Select stream types..."
                          multiple
                          disabled={userData.excludeCached === true}
                        />
                        <Select
                          label="Apply mode"
                          disabled={userData.excludeCached === true}
                          help="How these three options (from addons, services and stream types) are applied. AND means a result must match all, OR means a result only needs to match one"
                          value={userData.excludeCachedMode ?? 'or'}
                          onValueChange={(value) => {
                            setUserData((prev) => ({
                              ...prev,
                              excludeCachedMode: value as 'or' | 'and',
                            }));
                          }}
                          options={[
                            { label: 'OR', value: 'or' },
                            { label: 'AND', value: 'and' },
                          ]}
                        />
                      </>
                    )}
                  </div>
                </SettingsCard>
              </div>
            </>
          </TabsContent>

          <TabsContent value="resolution" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Resolution" />
              <FilterSettings<Resolution>
                filterName="Resolutions"
                preferredOptions={
                  userData.preferredResolutions || defaultPreferredResolutions
                }
                requiredOptions={userData.requiredResolutions || []}
                excludedOptions={userData.excludedResolutions || []}
                includedOptions={userData.includedResolutions || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredResolutions: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredResolutions: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedResolutions: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedResolutions: included,
                  }))
                }
                options={RESOLUTIONS.map((resolution) => ({
                  name: resolution,
                  value: resolution,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="quality" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Quality" />
              <FilterSettings<Quality>
                filterName="Qualities"
                preferredOptions={
                  userData.preferredQualities || defaultPreferredQualities
                }
                requiredOptions={userData.requiredQualities || []}
                excludedOptions={userData.excludedQualities || []}
                includedOptions={userData.includedQualities || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredQualities: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredQualities: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedQualities: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedQualities: included,
                  }))
                }
                options={QUALITIES.map((quality) => ({
                  name: quality,
                  value: quality,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="encode" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Encode" />
              <FilterSettings<Encode>
                filterName="Encodes"
                preferredOptions={
                  userData.preferredEncodes || defaultPreferredEncodes
                }
                requiredOptions={userData.requiredEncodes || []}
                excludedOptions={userData.excludedEncodes || []}
                includedOptions={userData.includedEncodes || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredEncodes: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredEncodes: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedEncodes: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedEncodes: included,
                  }))
                }
                options={ENCODES.map((encode) => ({
                  name: encode,
                  value: encode,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="stream-type" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Stream Type" />
              <FilterSettings<StreamType>
                filterName="Stream Types"
                preferredOptions={
                  userData.preferredStreamTypes || defaultPreferredStreamTypes
                }
                requiredOptions={userData.requiredStreamTypes || []}
                excludedOptions={userData.excludedStreamTypes || []}
                includedOptions={userData.includedStreamTypes || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredStreamTypes: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredStreamTypes: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedStreamTypes: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedStreamTypes: included,
                  }))
                }
                options={STREAM_TYPES.map((streamType) => ({
                  name: streamType,
                  value: streamType,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="visual-tag" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Visual Tag" />
              <FilterSettings<VisualTag>
                filterName="Visual Tags"
                preferredOptions={
                  userData.preferredVisualTags || defaultPreferredVisualTags
                }
                requiredOptions={userData.requiredVisualTags || []}
                excludedOptions={userData.excludedVisualTags || []}
                includedOptions={userData.includedVisualTags || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredVisualTags: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredVisualTags: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedVisualTags: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedVisualTags: included,
                  }))
                }
                options={VISUAL_TAGS.map((visualTag) => ({
                  name: visualTag,
                  value: visualTag,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="audio-tag" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Audio Tag" />
              <FilterSettings<AudioTag>
                filterName="Audio Tags"
                preferredOptions={userData.preferredAudioTags || []}
                requiredOptions={userData.requiredAudioTags || []}
                excludedOptions={userData.excludedAudioTags || []}
                includedOptions={userData.includedAudioTags || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredAudioTags: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredAudioTags: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedAudioTags: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedAudioTags: included,
                  }))
                }
                options={AUDIO_TAGS.map((audioTag) => ({
                  name: audioTag,
                  value: audioTag,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="audio-channel" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Audio Channel" />
              <FilterSettings<AudioChannel>
                filterName="Audio Channels"
                preferredOptions={userData.preferredAudioChannels || []}
                requiredOptions={userData.requiredAudioChannels || []}
                excludedOptions={userData.excludedAudioChannels || []}
                includedOptions={userData.includedAudioChannels || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredAudioChannels: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredAudioChannels: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedAudioChannels: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedAudioChannels: included,
                  }))
                }
                options={AUDIO_CHANNELS.map((audioChannel) => ({
                  name: audioChannel,
                  value: audioChannel,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="language" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Language" />
              <FilterSettings<Language>
                filterName="Languages"
                preferredOptions={userData.preferredLanguages || []}
                requiredOptions={userData.requiredLanguages || []}
                excludedOptions={userData.excludedLanguages || []}
                includedOptions={userData.includedLanguages || []}
                onPreferredChange={(preferred) =>
                  setUserData((prev) => ({
                    ...prev,
                    preferredLanguages: preferred,
                  }))
                }
                onRequiredChange={(required) =>
                  setUserData((prev) => ({
                    ...prev,
                    requiredLanguages: required,
                  }))
                }
                onExcludedChange={(excluded) =>
                  setUserData((prev) => ({
                    ...prev,
                    excludedLanguages: excluded,
                  }))
                }
                onIncludedChange={(included) =>
                  setUserData((prev) => ({
                    ...prev,
                    includedLanguages: included,
                  }))
                }
                options={LANGUAGES.map((language) => ({
                  name: language
                    .split(' ')
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' '),
                  value: language,
                }))}
              />
            </>
          </TabsContent>
          <TabsContent value="seeders" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Seeders" />
              <SettingsCard
                title="Seeder Filters"
                description="Configure required, excluded, and included seeder ranges"
              >
                <div className="space-y-4">
                  <div className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1 min-w-0">
                        <Slider
                          min={MIN_SEEDERS}
                          max={MAX_SEEDERS}
                          defaultValue={[MIN_SEEDERS, MAX_SEEDERS]}
                          value={
                            userData.requiredSeederRange || [
                              MIN_SEEDERS,
                              MAX_SEEDERS,
                            ]
                          }
                          onValueChange={(newValue) =>
                            newValue !== undefined &&
                            newValue?.[0] !== undefined &&
                            newValue?.[1] !== undefined &&
                            setUserData((prev) => ({
                              ...prev,
                              requiredSeederRange: [newValue[0], newValue[1]],
                            }))
                          }
                          minStepsBetweenThumbs={1}
                          label="Required Seeder Range"
                          help="Streams with seeders outside this range will be excluded"
                        />
                        <div className="flex justify-between mt-1 text-xs text-[--muted]">
                          <span>
                            {userData.requiredSeederRange?.[0] || MIN_SEEDERS}
                          </span>
                          <span>
                            {userData.requiredSeederRange?.[1] || MAX_SEEDERS}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 md:w-[240px] shrink-0">
                        <NumberInput
                          label="Min"
                          value={
                            userData.requiredSeederRange?.[0] || MIN_SEEDERS
                          }
                          min={MIN_SEEDERS}
                          max={userData.requiredSeederRange?.[1] || MAX_SEEDERS}
                          onValueChange={(newValue) =>
                            newValue !== undefined &&
                            setUserData((prev) => ({
                              ...prev,
                              requiredSeederRange: [
                                newValue,
                                prev.requiredSeederRange?.[1] || MAX_SEEDERS,
                              ],
                            }))
                          }
                        />
                        <NumberInput
                          label="Max"
                          value={
                            userData.requiredSeederRange?.[1] || MAX_SEEDERS
                          }
                          min={userData.requiredSeederRange?.[0] || MIN_SEEDERS}
                          max={MAX_SEEDERS}
                          onValueChange={(newValue) =>
                            newValue !== undefined &&
                            setUserData((prev) => ({
                              ...prev,
                              requiredSeederRange: [
                                prev.requiredSeederRange?.[0] || MIN_SEEDERS,
                                newValue,
                              ],
                            }))
                          }
                        />
                      </div>
                    </div>

                    {mode === 'pro' && (
                      <>
                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="flex-1 min-w-0">
                            <Slider
                              min={MIN_SEEDERS}
                              max={MAX_SEEDERS}
                              defaultValue={[MIN_SEEDERS, MAX_SEEDERS]}
                              value={
                                userData.excludeSeederRange || [
                                  MIN_SEEDERS,
                                  MAX_SEEDERS,
                                ]
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                newValue?.[0] !== undefined &&
                                newValue?.[1] !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  excludeSeederRange: [
                                    newValue[0],
                                    newValue[1],
                                  ],
                                }))
                              }
                              minStepsBetweenThumbs={1}
                              label="Excluded Seeder Range"
                              help="Streams with seeders in this range will be excluded"
                            />
                            <div className="flex justify-between mt-1 text-xs text-[--muted]">
                              <span>
                                {userData.excludeSeederRange?.[0] ||
                                  MIN_SEEDERS}
                              </span>
                              <span>
                                {userData.excludeSeederRange?.[1] ||
                                  MAX_SEEDERS}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 md:w-[240px] shrink-0">
                            <NumberInput
                              label="Min"
                              value={
                                userData.excludeSeederRange?.[0] || MIN_SEEDERS
                              }
                              min={MIN_SEEDERS}
                              max={
                                userData.excludeSeederRange?.[1] || MAX_SEEDERS
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  excludeSeederRange: [
                                    newValue,
                                    prev.excludeSeederRange?.[1] || MAX_SEEDERS,
                                  ],
                                }))
                              }
                            />
                            <NumberInput
                              label="Max"
                              value={
                                userData.excludeSeederRange?.[1] || MAX_SEEDERS
                              }
                              min={
                                userData.excludeSeederRange?.[0] || MIN_SEEDERS
                              }
                              max={MAX_SEEDERS}
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  excludeSeederRange: [
                                    prev.excludeSeederRange?.[0] || MIN_SEEDERS,
                                    newValue,
                                  ],
                                }))
                              }
                            />
                          </div>
                        </div>
                      </>
                    )}
                    {mode === 'pro' && (
                      <>
                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="flex-1 min-w-0">
                            <Slider
                              min={MIN_SEEDERS}
                              max={MAX_SEEDERS}
                              defaultValue={[MIN_SEEDERS, MAX_SEEDERS]}
                              value={
                                userData.includeSeederRange || [
                                  MIN_SEEDERS,
                                  MAX_SEEDERS,
                                ]
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                newValue?.[0] !== undefined &&
                                newValue?.[1] !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  includeSeederRange: [
                                    newValue[0],
                                    newValue[1],
                                  ],
                                }))
                              }
                              minStepsBetweenThumbs={1}
                              label="Included Seeder Range"
                              help="Streams with seeders in this range will be included, ignoring ANY other exclude/required filters, not just for this filter"
                            />
                            <div className="flex justify-between mt-1 text-xs text-[--muted]">
                              <span>
                                {userData.includeSeederRange?.[0] ||
                                  MIN_SEEDERS}
                              </span>
                              <span>
                                {userData.includeSeederRange?.[1] ||
                                  MAX_SEEDERS}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 md:w-[240px] shrink-0">
                            <NumberInput
                              label="Min"
                              value={
                                userData.includeSeederRange?.[0] || MIN_SEEDERS
                              }
                              min={MIN_SEEDERS}
                              max={
                                userData.includeSeederRange?.[1] || MAX_SEEDERS
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  includeSeederRange: [
                                    newValue,
                                    prev.includeSeederRange?.[1] || MAX_SEEDERS,
                                  ],
                                }))
                              }
                            />
                            <NumberInput
                              label="Max"
                              value={
                                userData.includeSeederRange?.[1] || MAX_SEEDERS
                              }
                              min={
                                userData.includeSeederRange?.[0] || MIN_SEEDERS
                              }
                              max={MAX_SEEDERS}
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  includeSeederRange: [
                                    prev.includeSeederRange?.[0] || MIN_SEEDERS,
                                    newValue,
                                  ],
                                }))
                              }
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="space-y-4">
                    <Combobox
                      label="Stream Types"
                      emptyMessage="There aren't any stream types to choose from..."
                      options={['p2p', 'cached', 'uncached'].map((type) => ({
                        label: type,
                        value: type,
                      }))}
                      value={userData.seederRangeTypes || []}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          seederRangeTypes: value as (
                            | 'p2p'
                            | 'cached'
                            | 'uncached'
                          )[],
                        }));
                      }}
                      help="Stream types that will use the seeder ranges defined above. Leave blank to apply to all stream types."
                      multiple
                    />
                  </div>
                </div>
              </SettingsCard>
            </>
          </TabsContent>
          <TabsContent value="age" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Age" />
              <SettingsCard
                title="Age Filters"
                description="Configure required, excluded, and included age ranges (in hours since upload)"
              >
                <div className="space-y-4">
                  <div className="space-y-6">
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1 min-w-0">
                        <Slider
                          min={MIN_AGE_HOURS}
                          max={MAX_AGE_HOURS}
                          step={24}
                          defaultValue={[MIN_AGE_HOURS, MAX_AGE_HOURS]}
                          value={
                            userData.requiredAgeRange || [
                              MIN_AGE_HOURS,
                              MAX_AGE_HOURS,
                            ]
                          }
                          onValueChange={(newValue) =>
                            newValue !== undefined &&
                            newValue?.[0] !== undefined &&
                            newValue?.[1] !== undefined &&
                            setUserData((prev) => ({
                              ...prev,
                              requiredAgeRange: [newValue[0], newValue[1]],
                            }))
                          }
                          minStepsBetweenThumbs={1}
                          label="Required Age Range"
                          help="Streams with age outside this range will be excluded"
                        />
                        <div className="flex justify-between mt-1 text-xs text-[--muted]">
                          <span>
                            {formatAgeDisplay(
                              userData.requiredAgeRange?.[0] || MIN_AGE_HOURS
                            )}
                          </span>
                          <span>
                            {formatAgeDisplay(
                              userData.requiredAgeRange?.[1] || MAX_AGE_HOURS
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 md:w-[240px] shrink-0">
                        <NumberInput
                          label="Min"
                          step={24}
                          value={
                            userData.requiredAgeRange?.[0] || MIN_AGE_HOURS
                          }
                          min={MIN_AGE_HOURS}
                          max={userData.requiredAgeRange?.[1] || MAX_AGE_HOURS}
                          onValueChange={(newValue) =>
                            newValue !== undefined &&
                            setUserData((prev) => ({
                              ...prev,
                              requiredAgeRange: [
                                newValue,
                                prev.requiredAgeRange?.[1] || MAX_AGE_HOURS,
                              ],
                            }))
                          }
                        />
                        <NumberInput
                          label="Max"
                          step={24}
                          value={
                            userData.requiredAgeRange?.[1] || MAX_AGE_HOURS
                          }
                          min={userData.requiredAgeRange?.[0] || MIN_AGE_HOURS}
                          max={MAX_AGE_HOURS}
                          onValueChange={(newValue) =>
                            newValue !== undefined &&
                            setUserData((prev) => ({
                              ...prev,
                              requiredAgeRange: [
                                prev.requiredAgeRange?.[0] || MIN_AGE_HOURS,
                                newValue,
                              ],
                            }))
                          }
                        />
                      </div>
                    </div>

                    {mode === 'pro' && (
                      <>
                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="flex-1 min-w-0">
                            <Slider
                              min={MIN_AGE_HOURS}
                              max={MAX_AGE_HOURS}
                              step={24}
                              defaultValue={[MIN_AGE_HOURS, MAX_AGE_HOURS]}
                              value={
                                userData.excludeAgeRange || [
                                  MIN_AGE_HOURS,
                                  MAX_AGE_HOURS,
                                ]
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                newValue?.[0] !== undefined &&
                                newValue?.[1] !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  excludeAgeRange: [newValue[0], newValue[1]],
                                }))
                              }
                              minStepsBetweenThumbs={1}
                              label="Excluded Age Range"
                              help="Streams with age in this range will be excluded"
                            />
                            <div className="flex justify-between mt-1 text-xs text-[--muted]">
                              <span>
                                {formatAgeDisplay(
                                  userData.excludeAgeRange?.[0] || MIN_AGE_HOURS
                                )}
                              </span>
                              <span>
                                {formatAgeDisplay(
                                  userData.excludeAgeRange?.[1] || MAX_AGE_HOURS
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 md:w-[240px] shrink-0">
                            <NumberInput
                              label="Min"
                              step={24}
                              value={
                                userData.excludeAgeRange?.[0] || MIN_AGE_HOURS
                              }
                              min={MIN_AGE_HOURS}
                              max={
                                userData.excludeAgeRange?.[1] || MAX_AGE_HOURS
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  excludeAgeRange: [
                                    newValue,
                                    prev.excludeAgeRange?.[1] || MAX_AGE_HOURS,
                                  ],
                                }))
                              }
                            />
                            <NumberInput
                              label="Max"
                              step={24}
                              value={
                                userData.excludeAgeRange?.[1] || MAX_AGE_HOURS
                              }
                              min={
                                userData.excludeAgeRange?.[0] || MIN_AGE_HOURS
                              }
                              max={MAX_AGE_HOURS}
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  excludeAgeRange: [
                                    prev.excludeAgeRange?.[0] || MIN_AGE_HOURS,
                                    newValue,
                                  ],
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="flex-1 min-w-0">
                            <Slider
                              min={MIN_AGE_HOURS}
                              max={MAX_AGE_HOURS}
                              step={24}
                              defaultValue={[MIN_AGE_HOURS, MAX_AGE_HOURS]}
                              value={
                                userData.includeAgeRange || [
                                  MIN_AGE_HOURS,
                                  MAX_AGE_HOURS,
                                ]
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                newValue?.[0] !== undefined &&
                                newValue?.[1] !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  includeAgeRange: [newValue[0], newValue[1]],
                                }))
                              }
                              minStepsBetweenThumbs={1}
                              label="Included Age Range"
                              help="Streams with age in this range will be included even if they would be excluded otherwise"
                            />
                            <div className="flex justify-between mt-1 text-xs text-[--muted]">
                              <span>
                                {formatAgeDisplay(
                                  userData.includeAgeRange?.[0] || MIN_AGE_HOURS
                                )}
                              </span>
                              <span>
                                {formatAgeDisplay(
                                  userData.includeAgeRange?.[1] || MAX_AGE_HOURS
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex gap-2 md:w-[240px] shrink-0">
                            <NumberInput
                              label="Min"
                              step={24}
                              value={
                                userData.includeAgeRange?.[0] || MIN_AGE_HOURS
                              }
                              min={MIN_AGE_HOURS}
                              max={
                                userData.includeAgeRange?.[1] || MAX_AGE_HOURS
                              }
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  includeAgeRange: [
                                    newValue,
                                    prev.includeAgeRange?.[1] || MAX_AGE_HOURS,
                                  ],
                                }))
                              }
                            />
                            <NumberInput
                              label="Max"
                              step={24}
                              value={
                                userData.includeAgeRange?.[1] || MAX_AGE_HOURS
                              }
                              min={
                                userData.includeAgeRange?.[0] || MIN_AGE_HOURS
                              }
                              max={MAX_AGE_HOURS}
                              onValueChange={(newValue) =>
                                newValue !== undefined &&
                                setUserData((prev) => ({
                                  ...prev,
                                  includeAgeRange: [
                                    prev.includeAgeRange?.[0] || MIN_AGE_HOURS,
                                    newValue,
                                  ],
                                }))
                              }
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="space-y-4">
                    <Combobox
                      label="Stream Types"
                      emptyMessage="There aren't any stream types to choose from..."
                      options={['debrid', 'usenet', 'p2p'].map((type) => ({
                        label: type,
                        value: type,
                      }))}
                      defaultValue={['usenet']}
                      value={userData.ageRangeTypes || ['usenet']}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          ageRangeTypes: value as (
                            | 'debrid'
                            | 'usenet'
                            | 'p2p'
                          )[],
                        }));
                      }}
                      help="Stream types that will use the age ranges defined above. Leave blank to apply to all stream types."
                      multiple
                    />
                  </div>
                </div>
              </SettingsCard>
            </>
          </TabsContent>
          <TabsContent value="title-matching" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Matching" />
              <div className="space-y-4">
                <SettingsCard
                  title="Title Matching"
                  description="Any streams which don't specifically match the requested title will be filtered out. You can optionally choose to only apply it to specific request types and addons. This requires a TMDB Read Access Token to be set in the Services menu."
                >
                  <Switch
                    label="Enabled"
                    side="right"
                    value={userData.titleMatching?.enabled ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        titleMatching: {
                          ...(prev.titleMatching || {}),
                          enabled: value,
                        },
                      }));
                    }}
                  />

                  <Select
                    disabled={!userData.titleMatching?.enabled}
                    label="Matching Mode"
                    options={['exact', 'contains'].map((mode) => ({
                      label: mode,
                      value: mode,
                    }))}
                    defaultValue="exact"
                    value={userData.titleMatching?.mode}
                    help={
                      userData.titleMatching?.mode === 'contains'
                        ? "Streams whose detected title doesn't contain the requested title will be excluded"
                        : "Streams whose detected title doesn't match the requested title exactly will be excluded"
                    }
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        titleMatching: {
                          ...prev.titleMatching,
                          mode: value as 'exact' | 'contains' | undefined,
                        },
                      }));
                    }}
                  />

                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Slider
                        label="Similarity Threshold"
                        help="The minimum similarity threshold required for a title to be considered a match. Lower values allow more leniency whereas higher values are more strict."
                        moreHelp="The similarity is calculated using the Levenshtein distance algorithm."
                        disabled={!userData.titleMatching?.enabled}
                        value={[
                          userData.titleMatching?.similarityThreshold ?? 0.85,
                        ]}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={[0.85]}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            titleMatching: {
                              ...prev.titleMatching,
                              similarityThreshold: value[0],
                            },
                          }));
                        }}
                      />
                    </div>
                    <div className="w-24">
                      <NumberInput
                        label="Value"
                        step={0.01}
                        value={
                          userData.titleMatching?.similarityThreshold ?? 0.85
                        }
                        min={0}
                        max={1}
                        disabled={!userData.titleMatching?.enabled}
                        onValueChange={(newValue) => {
                          if (newValue !== undefined) {
                            setUserData((prev) => ({
                              ...prev,
                              titleMatching: {
                                ...prev.titleMatching,
                                similarityThreshold: newValue,
                              },
                            }));
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Combobox
                        multiple
                        disabled={!userData.titleMatching?.enabled}
                        label="Request Types"
                        emptyMessage="There aren't any request types to choose from..."
                        help="Request types that will use title matching. Leave blank to apply to all request types."
                        options={TYPES.map((type) => ({
                          label: type,
                          value: type,
                          textValue: type,
                        }))}
                        value={userData.titleMatching?.requestTypes}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            titleMatching: {
                              ...prev.titleMatching,
                              requestTypes: value,
                            },
                          }));
                        }}
                      />
                      <Combobox
                        multiple
                        disabled={!userData.titleMatching?.enabled}
                        label="Addons"
                        help="Addons that will use strict title matching. Leave blank to apply to all addons."
                        emptyMessage="You haven't installed any addons yet..."
                        options={userData.presets.map((preset) => ({
                          label: preset.options.name || preset.type,
                          textValue: preset.options.name || preset.type,
                          value: preset.instanceId,
                        }))}
                        value={userData.titleMatching?.addons || []}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            titleMatching: {
                              ...prev.titleMatching,
                              addons: value,
                            },
                          }));
                        }}
                      />
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard
                  title="Year Matching"
                  description="Any streams which don't specifically match the requested year will be filtered out. You can optionally choose to only apply it to specific request types and addons"
                >
                  <Switch
                    label="Enable"
                    side="right"
                    value={userData.yearMatching?.enabled ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        yearMatching: { ...prev.yearMatching, enabled: value },
                      }));
                    }}
                  />
                  <Switch
                    label="Strict"
                    side="right"
                    help="Filter out streams for movies that don't have a year specified."
                    moreHelp="Disabling this will allow streams without a year to be included in the results."
                    disabled={!userData.yearMatching?.enabled}
                    value={userData.yearMatching?.strict ?? true}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        yearMatching: { ...prev.yearMatching, strict: value },
                      }));
                    }}
                  />
                  <NumberInput
                    label="Year Tolerance"
                    disabled={!userData.yearMatching?.enabled}
                    value={userData.yearMatching?.tolerance ?? 1}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        yearMatching: {
                          ...prev.yearMatching,
                          tolerance: value,
                        },
                      }));
                    }}
                    min={0}
                    max={100}
                    help="The number of years to tolerate when matching years. For example, if the year tolerance is 5, then a stream with a year of 2020 will match a request for 2025."
                  />
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Combobox
                        multiple
                        disabled={!userData.yearMatching?.enabled}
                        label="Request Types"
                        emptyMessage="There aren't any request types to choose from..."
                        help="Request types that will use year matching. Leave blank to apply to all request types."
                        options={TYPES.map((type) => ({
                          label: type,
                          value: type,
                          textValue: type,
                        }))}
                        value={userData.yearMatching?.requestTypes}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            yearMatching: {
                              ...prev.yearMatching,
                              requestTypes: value,
                            },
                          }));
                        }}
                      />
                      <Combobox
                        multiple
                        disabled={!userData.yearMatching?.enabled}
                        label="Addons"
                        help="Addons that will use year matching. Leave blank to apply to all addons."
                        emptyMessage="You haven't installed any addons yet..."
                        options={userData.presets.map((preset) => ({
                          label: preset.options.name || preset.type,
                          textValue: preset.options.name || preset.type,
                          value: preset.instanceId,
                        }))}
                        value={userData.yearMatching?.addons || []}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            yearMatching: {
                              ...prev.yearMatching,
                              addons: value,
                            },
                          }));
                        }}
                      />
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard
                  title="Season/Episode Matching"
                  description="Any streams which don't specifically match the requested season/episode will be filtered out. You can optionally choose to only apply it to specific request types and addons"
                >
                  <Switch
                    label="Enabled"
                    side="right"
                    value={userData.seasonEpisodeMatching?.enabled ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        seasonEpisodeMatching: {
                          ...(prev.seasonEpisodeMatching || {}),
                          enabled: value,
                        },
                      }));
                    }}
                  />
                  <Switch
                    label="Strict"
                    side="right"
                    help="Filter out streams for series that don't have any season or episode specified."
                    moreHelp="Disabling this will allow streams without a season or episode to be included in the results."
                    disabled={!userData.seasonEpisodeMatching?.enabled}
                    value={userData.seasonEpisodeMatching?.strict ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        seasonEpisodeMatching: {
                          ...prev.seasonEpisodeMatching,
                          strict: value,
                        },
                      }));
                    }}
                  />
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Combobox
                        multiple
                        disabled={!userData.seasonEpisodeMatching?.enabled}
                        label="Request Types"
                        help="Request types that will use season/episode matching. Leave blank to apply to all request types."
                        emptyMessage="There aren't any request types to choose from..."
                        options={TYPES.map((type) => ({
                          label: type,
                          value: type,
                          textValue: type,
                        }))}
                        value={userData.seasonEpisodeMatching?.requestTypes}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            seasonEpisodeMatching: {
                              ...prev.seasonEpisodeMatching,
                              requestTypes: value,
                            },
                          }));
                        }}
                      />
                      <Combobox
                        multiple
                        disabled={!userData.seasonEpisodeMatching?.enabled}
                        label="Addons"
                        help="Addons that will use season/episode matching. Leave blank to apply to all addons."
                        emptyMessage="You haven't installed any addons yet..."
                        options={userData.presets.map((preset) => ({
                          label: preset.options.name || preset.type,
                          textValue: preset.options.name || preset.type,
                          value: preset.instanceId,
                        }))}
                        value={userData.seasonEpisodeMatching?.addons || []}
                        onValueChange={(value) => {
                          setUserData((prev) => {
                            return {
                              ...prev,
                              seasonEpisodeMatching: {
                                ...prev.seasonEpisodeMatching,
                                addons: value,
                              },
                            };
                          });
                        }}
                      />
                    </div>
                  </div>
                </SettingsCard>
              </div>
            </>
          </TabsContent>
          <TabsContent value="stream-expression" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Stream Expression" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Create advanced filters to exclude, prefer or require specific
                  streams from your results using stream expressions. Write
                  expressions that evaluate which streams to select based on
                  properties like addon type, quality, size, or any other stream
                  attributes. Multiple expressions can be combined using logical
                  operators for precise filtering control. You can also use
                  ternary operators to apply conditional logic to the streams.
                </p>
              </div>
              <div className="mb-4 space-y-4">
                {status?.settings.selSyncAccess === 'trusted' &&
                  (userData.trusted ? (
                    <Alert
                      intent="success"
                      title="Trusted User"
                      description={
                        <div className="space-y-2">
                          <p>
                            You are a trusted user. You can sync expressions
                            from any URL.
                          </p>
                          {status?.settings.whitelistedSelUrls &&
                            status.settings.whitelistedSelUrls.length > 0 && (
                              <div className="flex flex-row flex-wrap gap-2">
                                <Button
                                  intent="primary-outline"
                                  size="sm"
                                  onClick={whitelistedSelUrlsModal.open}
                                >
                                  View Whitelisted Sync URLs
                                </Button>
                              </div>
                            )}
                        </div>
                      }
                    />
                  ) : (
                    <Alert
                      intent="info"
                      title="Trusted Users Only"
                      description={
                        <div className="space-y-2">
                          <p>
                            Syncing stream expressions from arbitrary URLs is
                            only available to trusted users. You can only sync
                            from whitelisted URLs. If you are the owner of the
                            instance, you can add your UUID to the{' '}
                            <code className="font-mono">TRUSTED_UUIDS</code>{' '}
                            environment variable.
                          </p>
                          {status?.settings.whitelistedSelUrls &&
                            status.settings.whitelistedSelUrls.length > 0 && (
                              <div className="flex flex-row flex-wrap gap-2">
                                <Button
                                  intent="primary-outline"
                                  size="sm"
                                  onClick={whitelistedSelUrlsModal.open}
                                >
                                  View Whitelisted Sync URLs
                                </Button>
                              </div>
                            )}
                        </div>
                      }
                    />
                  ))}
              </div>
              <div className="space-y-4">
                <SettingsCard title="Help">
                  <div className="space-y-3">
                    <p className="text-sm text-[--muted]">
                      This filter uses AIOStreams'{' '}
                      <a
                        href="https://github.com/Viren070/AIOStreams/wiki/Stream-Expression-Language"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[--brand] hover:underline"
                      >
                        stream expression language
                      </a>
                      , the same syntax used in the Groups system. The
                      difference here is that you only have the{' '}
                      <code>streams</code> constant containing all available
                      streams
                    </p>
                    <div className="text-sm text-[--muted]">
                      <p className="font-medium mb-2">How it works:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>
                          Your expression should return an array of streams
                        </li>
                        <li>
                          Use functions like <code>addon()</code>,{' '}
                          <code>type()</code>, <code>quality()</code> to filter
                          streams
                        </li>
                        <li>
                          Combine multiple attributes together using nested
                          functions
                        </li>
                        <li>
                          Apply conditional logic using ternary operators{' '}
                          <code>expression ? arrayIfTrue : arrayIfFalse</code>{' '}
                          where the two arrays can be replaced with true or
                          false for all streams and no streams respectively.
                        </li>
                      </ul>
                    </div>
                    <p className="text-sm text-[--muted]">
                      <strong>Example:</strong>{' '}
                      <code>addon(type(streams, 'debrid'), 'TorBox')</code>{' '}
                      excludes all TorBox debrid streams.
                    </p>
                    <p className="text-sm text-[--muted]">
                      For detailed syntax and available functions, see the{' '}
                      <a
                        href="https://github.com/Viren070/AIOStreams/wiki/Stream-Expression-Language#complete-function-reference"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[--brand] hover:underline"
                      >
                        Full function reference
                      </a>
                    </p>
                  </div>
                </SettingsCard>
                <ToggleableTextInputs
                  title="Required Stream Expressions"
                  description="The expressions to apply to the streams. Streams selected by any of these expressions will be required to be in the results."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.requiredStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredStreamExpressions: values,
                    }));
                  }}
                  onExpressionChange={(expression, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredStreamExpressions: [
                        ...(prev.requiredStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.requiredStreamExpressions || [])[index],
                          expression,
                        },
                        ...(prev.requiredStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  onEnabledChange={(enabled, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredStreamExpressions: [
                        ...(prev.requiredStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.requiredStreamExpressions || [])[index],
                          enabled,
                        },
                        ...(prev.requiredStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  {...getSyncedProps('syncedRequiredStreamExpressionUrls')}
                />
                <ToggleableTextInputs
                  title="Excluded Stream Expressions"
                  description="The expressions to apply to the streams. Streams selected by any of these expressions will be excluded from the results."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.excludedStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedStreamExpressions: values,
                    }));
                  }}
                  onExpressionChange={(expression, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedStreamExpressions: [
                        ...(prev.excludedStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.excludedStreamExpressions || [])[index],
                          expression,
                        },
                        ...(prev.excludedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  onEnabledChange={(enabled, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedStreamExpressions: [
                        ...(prev.excludedStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.excludedStreamExpressions || [])[index],
                          enabled,
                        },
                        ...(prev.excludedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  {...getSyncedProps('syncedExcludedStreamExpressionUrls')}
                />
                <ToggleableTextInputs
                  title="Included Stream Expressions"
                  description="The expressions to apply to the streams. Streams selected by any of these expressions will be included in the results."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.includedStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedStreamExpressions: values,
                    }));
                  }}
                  onExpressionChange={(expression, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedStreamExpressions: [
                        ...(prev.includedStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.includedStreamExpressions || [])[index],
                          expression,
                        },
                        ...(prev.includedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  onEnabledChange={(enabled, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedStreamExpressions: [
                        ...(prev.includedStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.includedStreamExpressions || [])[index],
                          enabled,
                        },
                        ...(prev.includedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  {...getSyncedProps('syncedIncludedStreamExpressionUrls')}
                />
                <ToggleableTextInputs
                  title="Preferred Stream Expressions"
                  description="The expressions to apply to the streams. Streams selected by these expressions will be preferred over other streams and ranked by the order they are in this list."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.preferredStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredStreamExpressions: values,
                    }));
                  }}
                  onExpressionChange={(expression, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredStreamExpressions: [
                        ...(prev.preferredStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.preferredStreamExpressions || [])[index],
                          expression,
                        },
                        ...(prev.preferredStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  onEnabledChange={(enabled, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredStreamExpressions: [
                        ...(prev.preferredStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        {
                          ...(prev.preferredStreamExpressions || [])[index],
                          enabled,
                        },
                        ...(prev.preferredStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  {...getSyncedProps('syncedPreferredStreamExpressionUrls')}
                />
                <RankedExpressionInputs
                  title="Ranked Stream Expressions"
                  description="Add expressions with scores. All matching expressions accumulate their scores on each stream. Use negative scores to penalize matches. Sort by 'Stream Expression Score' to order by the total."
                  values={userData.rankedStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedStreamExpressions: values,
                    }));
                  }}
                  onExpressionChange={(expression, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedStreamExpressions: [
                        ...(prev.rankedStreamExpressions || []).slice(0, index),
                        {
                          ...(prev.rankedStreamExpressions || [])[index],
                          expression,
                        },
                        ...(prev.rankedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  onScoreChange={(score, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedStreamExpressions: [
                        ...(prev.rankedStreamExpressions || []).slice(0, index),
                        {
                          ...(prev.rankedStreamExpressions || [])[index],
                          score,
                        },
                        ...(prev.rankedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  onEnabledChange={(enabled, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedStreamExpressions: [
                        ...(prev.rankedStreamExpressions || []).slice(0, index),
                        {
                          ...(prev.rankedStreamExpressions || [])[index],
                          enabled,
                        },
                        ...(prev.rankedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                  {...getSyncedProps('syncedRankedStreamExpressionUrls')}
                />
              </div>
            </>
          </TabsContent>
          <TabsContent value="keyword" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Keyword" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Filter your streams by keywords - words or phrases that must
                  appear in the filename, folder name, indexer, or release group
                </p>
              </div>
              <div className="space-y-4">
                {mode === 'pro' && (
                  <TextInputs
                    label="Required Keywords"
                    help="Streams that do not contain any of these keywords will be excluded"
                    itemName="Keyword"
                    values={userData.requiredKeywords || []}
                    onValuesChange={(values) => {
                      setUserData((prev) => ({
                        ...prev,
                        requiredKeywords: values,
                      }));
                    }}
                  />
                )}
                <TextInputs
                  label="Excluded Keywords"
                  help="Streams that contain any of these keywords will be excluded"
                  itemName="Keyword"
                  values={userData.excludedKeywords || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedKeywords: values,
                    }));
                  }}
                />
                {mode === 'pro' && (
                  <TextInputs
                    label="Included Keywords"
                    help="Streams that contain any of these keywords will be included, ignoring ANY other exclude/required filters, not just for this filter"
                    itemName="Keyword"
                    values={userData.includedKeywords || []}
                    onValuesChange={(values) => {
                      setUserData((prev) => ({
                        ...prev,
                        includedKeywords: values,
                      }));
                    }}
                  />
                )}
                <TextInputs
                  label="Preferred Keywords"
                  help="Streams that contain any of these keywords will be preferred"
                  itemName="Keyword"
                  values={userData.preferredKeywords || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredKeywords: values,
                    }));
                  }}
                />
              </div>
            </>
          </TabsContent>
          <TabsContent value="release-group" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Release Group" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Filter your streams by release group - the group that released
                  the content (e.g., SPARKS, NTb, FLUX, etc.)
                </p>
              </div>
              <div className="space-y-4">
                <TextInputs
                  label="Required Release Groups"
                  help="Only streams from these release groups will be kept. Streams from other release groups will be excluded."
                  itemName="Release Group"
                  values={userData.requiredReleaseGroups || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredReleaseGroups: values,
                    }));
                  }}
                />
                <TextInputs
                  label="Excluded Release Groups"
                  help="Streams from these release groups will be excluded"
                  itemName="Release Group"
                  values={userData.excludedReleaseGroups || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedReleaseGroups: values,
                    }));
                  }}
                />
                <TextInputs
                  label="Included Release Groups"
                  help="Streams from these release groups will be included, ignoring ANY other exclude/required filters, not just for this filter"
                  itemName="Release Group"
                  values={userData.includedReleaseGroups || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedReleaseGroups: values,
                    }));
                  }}
                />
                <TextInputs
                  label="Preferred Release Groups"
                  help="Streams from these release groups will be sorted higher. The order matters - release groups at the top will be preferred over those below."
                  itemName="Release Group"
                  values={userData.preferredReleaseGroups || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredReleaseGroups: values,
                    }));
                  }}
                />
              </div>
            </>
          </TabsContent>
          <TabsContent value="regex" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Regex" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Filter your streams by regular expressions that must match one
                  of the following: filename, folder name, indexer, or release
                  group
                </p>
              </div>
              <div className="mb-4 space-y-4">
                {status?.settings.regexFilterAccess === 'trusted' &&
                  (userData.trusted ? (
                    <Alert
                      intent="success"
                      title="Trusted User"
                      description={
                        <p>
                          You are a trusted user. You have full access to regex
                          filters.
                        </p>
                      }
                    />
                  ) : (
                    <Alert
                      intent="info"
                      title="Trusted Users Only"
                      description={
                        <>
                          <p>
                            Regex filters are only available to trusted users
                            due to the potential for abuse. If you are the owner
                            of the instance, you can add your UUID to the{' '}
                            <code className="font-mono">TRUSTED_UUIDS</code>{' '}
                            environment variable.
                          </p>
                        </>
                      }
                    />
                  ))}
                {status?.settings.allowedRegexPatterns?.patterns.length && (
                  <Alert
                    intent="info"
                    title="Allowed Regex Patterns"
                    description={
                      <div className="space-y-2">
                        <div className="max-w-full overflow-hidden">
                          <p className="break-words">
                            This instance has allowed a specific set of regexes
                            to be used by all users.
                          </p>
                          {status?.settings.allowedRegexPatterns
                            .description && (
                            <div className="mt-2 break-words overflow-hidden">
                              <MarkdownLite>
                                {status?.settings.allowedRegexPatterns
                                  .description || ''}
                              </MarkdownLite>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-row flex-wrap gap-2">
                          {status?.settings.allowedRegexPatterns?.urls &&
                            status.settings.allowedRegexPatterns.urls.length >
                              0 && (
                              <Button
                                intent="primary-outline"
                                size="sm"
                                onClick={allowedRegexUrlsModal.open}
                              >
                                View Allowed Import URLs
                              </Button>
                            )}
                          <Button
                            intent="primary-outline"
                            size="sm"
                            onClick={allowedRegexModal.open}
                          >
                            View Allowed Patterns
                          </Button>
                        </div>
                      </div>
                    }
                  />
                )}
              </div>
              <div className="space-y-4">
                {mode === 'pro' && (
                  <TextInputs
                    label="Required Regex"
                    help="Streams that do not match any of these regular expressions will be excluded"
                    itemName="Regex"
                    values={userData.requiredRegexPatterns || []}
                    onValuesChange={(values) => {
                      setUserData((prev) => ({
                        ...prev,
                        requiredRegexPatterns: values,
                      }));
                    }}
                    {...getSyncedProps('syncedRequiredRegexUrls')}
                  />
                )}
                <TextInputs
                  label="Excluded Regex"
                  help="Streams that match any of these regular expressions will be excluded"
                  itemName="Regex"
                  values={userData.excludedRegexPatterns || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedRegexPatterns: values,
                    }));
                  }}
                  {...getSyncedProps('syncedExcludedRegexUrls')}
                />
                {mode === 'pro' && (
                  <TextInputs
                    label="Included Regex"
                    help="Streams that match any of these regular expressions will be included, ignoring other exclude/required filters"
                    itemName="Regex"
                    values={userData.includedRegexPatterns || []}
                    onValuesChange={(values) => {
                      setUserData((prev) => ({
                        ...prev,
                        includedRegexPatterns: values,
                      }));
                    }}
                    {...getSyncedProps('syncedIncludedRegexUrls')}
                  />
                )}
                <TwoTextInputs
                  title="Preferred Regex Patterns"
                  description="Define regex patterns with names for easy reference"
                  {...getSyncedProps('syncedPreferredRegexUrls')}
                  keyName="Name"
                  keyId="name"
                  keyPlaceholder="Enter pattern name"
                  valueId="pattern"
                  valueName="Pattern"
                  valuePlaceholder="Enter regex pattern"
                  values={(userData.preferredRegexPatterns || []).map(
                    (pattern) => ({
                      name: pattern.name,
                      value: pattern.pattern,
                    })
                  )}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredRegexPatterns: values.map((v) => ({
                        name: v.name,
                        pattern: v.value,
                      })),
                    }));
                  }}
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredRegexPatterns: [
                        ...(prev.preferredRegexPatterns || []).slice(0, index),
                        {
                          ...(prev.preferredRegexPatterns || [])[index],
                          pattern: value,
                        },
                        ...(prev.preferredRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                  onKeyChange={(key, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredRegexPatterns: [
                        ...(prev.preferredRegexPatterns || []).slice(0, index),
                        {
                          ...(prev.preferredRegexPatterns || [])[index],
                          name: key,
                        },
                        ...(prev.preferredRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
                <RankedRegexInputs
                  title="Ranked Regex Patterns"
                  description="Add regex patterns with scores. Matches on filename only. Accumulates scores."
                  values={userData.rankedRegexPatterns || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedRegexPatterns: values,
                    }));
                  }}
                  onPatternChange={(pattern, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedRegexPatterns: [
                        ...(prev.rankedRegexPatterns || []).slice(0, index),
                        { ...(prev.rankedRegexPatterns || [])[index], pattern },
                        ...(prev.rankedRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                  onNameChange={(name, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedRegexPatterns: [
                        ...(prev.rankedRegexPatterns || []).slice(0, index),
                        { ...(prev.rankedRegexPatterns || [])[index], name },
                        ...(prev.rankedRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                  onScoreChange={(score, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      rankedRegexPatterns: [
                        ...(prev.rankedRegexPatterns || []).slice(0, index),
                        { ...(prev.rankedRegexPatterns || [])[index], score },
                        ...(prev.rankedRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                  syncConfig={{
                    urls: userData.syncedRankedRegexUrls || [],
                    onUrlsChange: (urls) =>
                      setUserData((prev) => ({
                        ...prev,
                        syncedRankedRegexUrls: urls,
                      })),
                    trusted: userData.trusted,
                  }}
                />
              </div>
            </>
          </TabsContent>
          <TabsContent value="bitrate" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Bitrate" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Set minimum and maximum bitrate limits for movies, series, and
                  anime series. You can set a global limit, and also choose to
                  set specific limits for each resolution. For a given stream,
                  only one set of bitrate filters would be used. A resolution
                  specific limit takes priority. Anime series limits take
                  precedence over regular series limits.
                </p>
              </div>
              <Alert
                intent="warning"
                className="mb-4"
                title="Bitrate Accuracy"
                description="Bitrate values are estimates calculated from file size and duration. These represent average bitrates and may not reflect peak bitrates or exact encoding quality."
              />
              <div className="space-y-4">
                <div className="rounded-[--radius-md] border bg-[--background] p-4">
                  <Switch
                    label="Use Runtime from Metadata Providers"
                    side="right"
                    help="When enabled, uses runtime data from metadata providers (like TMDB) for bitrate calculations as fallback. Note: This makes estimates less accurate as actual file durations often differ from metadata, and most files lack duration info, making sorting by bitrate similar to sorting by size."
                    value={userData.bitrate?.useMetadataRuntime ?? true}
                    onValueChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        bitrate: { ...prev.bitrate, useMetadataRuntime: value },
                      }));
                    }}
                  />
                </div>
                <SettingsCard
                  title="Global"
                  description="Apply bitrate filters for movies, series, and anime series"
                >
                  <BitrateRangeSlider
                    label="Global Bitrate Limits"
                    help="Set the minimum and maximum bitrate limits for all results"
                    moviesValue={
                      (
                        userData.bitrate?.global?.movies || [
                          MIN_BITRATE,
                          MAX_BITRATE,
                        ]
                      ).map((v) => Math.min(v, MAX_BITRATE)) as [number, number]
                    }
                    seriesValue={
                      (
                        userData.bitrate?.global?.series || [
                          MIN_BITRATE,
                          MAX_BITRATE,
                        ]
                      ).map((v) => Math.min(v, MAX_BITRATE)) as [number, number]
                    }
                    animeValue={
                      (
                        userData.bitrate?.global?.anime || [
                          MIN_BITRATE,
                          MAX_BITRATE,
                        ]
                      ).map((v) => Math.min(v, MAX_BITRATE)) as [number, number]
                    }
                    onMoviesChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        bitrate: {
                          ...prev.bitrate,
                          global: { ...prev.bitrate?.global, movies: value },
                        },
                      }));
                    }}
                    onSeriesChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        bitrate: {
                          ...prev.bitrate,
                          global: { ...prev.bitrate?.global, series: value },
                        },
                      }));
                    }}
                    onAnimeChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        bitrate: {
                          ...prev.bitrate,
                          global: { ...prev.bitrate?.global, anime: value },
                        },
                      }));
                    }}
                  />
                </SettingsCard>
                {mode === 'pro' && (
                  <SettingsCard
                    title="Resolution-Specific"
                    description="Set bitrate limits for specific resolutions"
                  >
                    <div className="space-y-8">
                      {RESOLUTIONS.map((resolution) => (
                        <BitrateRangeSlider
                          key={resolution}
                          label={resolution}
                          help={`Set the minimum and maximum bitrate for ${resolution} results`}
                          moviesValue={
                            (
                              userData.bitrate?.resolution?.[resolution]
                                ?.movies || [MIN_BITRATE, MAX_BITRATE]
                            ).map((v) => Math.min(v, MAX_BITRATE)) as [
                              number,
                              number,
                            ]
                          }
                          seriesValue={
                            (
                              userData.bitrate?.resolution?.[resolution]
                                ?.series || [MIN_BITRATE, MAX_BITRATE]
                            ).map((v) => Math.min(v, MAX_BITRATE)) as [
                              number,
                              number,
                            ]
                          }
                          animeValue={
                            (
                              userData.bitrate?.resolution?.[resolution]
                                ?.anime || [MIN_BITRATE, MAX_BITRATE]
                            ).map((v) => Math.min(v, MAX_BITRATE)) as [
                              number,
                              number,
                            ]
                          }
                          onMoviesChange={(value) => {
                            setUserData((prev: any) => ({
                              ...prev,
                              bitrate: {
                                ...prev.bitrate,
                                resolution: {
                                  ...prev.bitrate?.resolution,
                                  [resolution]: {
                                    ...prev.bitrate?.resolution?.[resolution],
                                    movies: value,
                                  },
                                },
                              },
                            }));
                          }}
                          onSeriesChange={(value) => {
                            setUserData((prev: any) => ({
                              ...prev,
                              bitrate: {
                                ...prev.bitrate,
                                resolution: {
                                  ...prev.bitrate?.resolution,
                                  [resolution]: {
                                    ...prev.bitrate?.resolution?.[resolution],
                                    series: value,
                                  },
                                },
                              },
                            }));
                          }}
                          onAnimeChange={(value) => {
                            setUserData((prev: any) => ({
                              ...prev,
                              bitrate: {
                                ...prev.bitrate,
                                resolution: {
                                  ...prev.bitrate?.resolution,
                                  [resolution]: {
                                    ...prev.bitrate?.resolution?.[resolution],
                                    anime: value,
                                  },
                                },
                              },
                            }));
                          }}
                        />
                      ))}
                    </div>
                  </SettingsCard>
                )}
              </div>
            </>
          </TabsContent>
          <TabsContent value="size" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Size" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Set minimum and maximum size limits for movies, series, and
                  anime series. You can set a global limit, and also choose to
                  set specific limits for each resolution. For a given stream,
                  only one set of size filters would be used. A resolution
                  specific limit takes priority. Anime series limits take
                  precedence over regular series limits.
                </p>
              </div>
              <div className="space-y-4">
                <SettingsCard
                  title="Global"
                  description="Apply size filters for movies, series, and anime series"
                >
                  <SizeRangeSlider
                    label="Global Size Limits"
                    help="Set the minimum and maximum size limits for all results"
                    moviesValue={
                      userData.size?.global?.movies || [MIN_SIZE, MAX_SIZE]
                    }
                    seriesValue={
                      userData.size?.global?.series || [MIN_SIZE, MAX_SIZE]
                    }
                    animeValue={
                      userData.size?.global?.anime || [MIN_SIZE, MAX_SIZE]
                    }
                    onMoviesChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        size: {
                          ...prev.size,
                          global: { ...prev.size?.global, movies: value },
                        },
                      }));
                    }}
                    onSeriesChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        size: {
                          ...prev.size,
                          global: { ...prev.size?.global, series: value },
                        },
                      }));
                    }}
                    onAnimeChange={(value) => {
                      setUserData((prev: any) => ({
                        ...prev,
                        size: {
                          ...prev.size,
                          global: { ...prev.size?.global, anime: value },
                        },
                      }));
                    }}
                  />
                </SettingsCard>
                {mode === 'pro' && (
                  <SettingsCard
                    title="Resolution-Specific"
                    description="Set size limits for specific resolutions"
                  >
                    <div className="space-y-8">
                      {RESOLUTIONS.map((resolution) => (
                        <SizeRangeSlider
                          key={resolution}
                          label={resolution}
                          help={`Set the minimum and maximum size for ${resolution} results`}
                          moviesValue={
                            userData.size?.resolution?.[resolution]?.movies || [
                              MIN_SIZE,
                              MAX_SIZE,
                            ]
                          }
                          seriesValue={
                            userData.size?.resolution?.[resolution]?.series || [
                              MIN_SIZE,
                              MAX_SIZE,
                            ]
                          }
                          animeValue={
                            userData.size?.resolution?.[resolution]?.anime || [
                              MIN_SIZE,
                              MAX_SIZE,
                            ]
                          }
                          onMoviesChange={(value) => {
                            setUserData((prev: any) => ({
                              ...prev,
                              size: {
                                ...prev.size,
                                resolution: {
                                  ...prev.size?.resolution,
                                  [resolution]: {
                                    ...prev.size?.resolution?.[resolution],
                                    movies: value,
                                  },
                                },
                              },
                            }));
                          }}
                          onSeriesChange={(value) => {
                            setUserData((prev: any) => ({
                              ...prev,
                              size: {
                                ...prev.size,
                                resolution: {
                                  ...prev.size?.resolution,
                                  [resolution]: {
                                    ...prev.size?.resolution?.[resolution],
                                    series: value,
                                  },
                                },
                              },
                            }));
                          }}
                          onAnimeChange={(value) => {
                            setUserData((prev: any) => ({
                              ...prev,
                              size: {
                                ...prev.size,
                                resolution: {
                                  ...prev.size?.resolution,
                                  [resolution]: {
                                    ...prev.size?.resolution?.[resolution],
                                    anime: value,
                                  },
                                },
                              },
                            }));
                          }}
                        />
                      ))}
                    </div>
                  </SettingsCard>
                )}
              </div>
            </>
          </TabsContent>
          <TabsContent value="limit" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Result Limits" />
              <SettingsCard description="Apply limits to specific kinds of results">
                <div className="space-y-4">
                  <NumberInput
                    help="Global limit for all results"
                    label="Global Limit"
                    value={userData.resultLimits?.global || undefined}
                    min={0}
                    defaultValue={undefined}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        resultLimits: {
                          ...prev.resultLimits,
                          global: value || undefined,
                        },
                      }));
                    }}
                  />
                  {mode === 'pro' && (
                    <NumberInput
                      help="Limit for results by service"
                      label="Service Limit"
                      value={userData.resultLimits?.service || undefined}
                      min={0}
                      defaultValue={undefined}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          resultLimits: {
                            ...prev.resultLimits,
                            service: value || undefined,
                          },
                        }));
                      }}
                    />
                  )}
                  {mode === 'pro' && (
                    <NumberInput
                      help="Limit for results by addon"
                      label="Addon Limit"
                      value={userData.resultLimits?.addon || undefined}
                      min={0}
                      defaultValue={undefined}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          resultLimits: {
                            ...prev.resultLimits,
                            addon: value || undefined,
                          },
                        }));
                      }}
                    />
                  )}
                  <NumberInput
                    help="Limit for results by resolution"
                    label="Resolution Limit"
                    value={userData.resultLimits?.resolution || undefined}
                    min={0}
                    defaultValue={undefined}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        resultLimits: {
                          ...prev.resultLimits,
                          resolution: value || undefined,
                        },
                      }));
                    }}
                  />
                  {mode === 'pro' && (
                    <NumberInput
                      help="Limit for results by quality"
                      label="Quality Limit"
                      value={userData.resultLimits?.quality || undefined}
                      min={0}
                      defaultValue={undefined}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          resultLimits: {
                            ...prev.resultLimits,
                            quality: value || undefined,
                          },
                        }));
                      }}
                    />
                  )}
                  {mode === 'pro' && (
                    <NumberInput
                      help="Limit for results by indexer"
                      label="Indexer Limit"
                      value={userData.resultLimits?.indexer || undefined}
                      min={0}
                      defaultValue={undefined}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          resultLimits: {
                            ...prev.resultLimits,
                            indexer: value || undefined,
                          },
                        }));
                      }}
                    />
                  )}
                  {mode === 'pro' && (
                    <NumberInput
                      help="Limit for results by release group"
                      label="Release Group Limit"
                      value={userData.resultLimits?.releaseGroup || undefined}
                      min={0}
                      defaultValue={undefined}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          resultLimits: {
                            ...prev.resultLimits,
                            releaseGroup: value || undefined,
                          },
                        }));
                      }}
                    />
                  )}
                </div>
              </SettingsCard>
            </>
          </TabsContent>
          <TabsContent value="deduplicator" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Deduplicator" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Enable and customise the removal of duplicate results.
                </p>
              </div>
              <div className="space-y-4">
                <SettingsCard>
                  <Switch
                    label="Enable"
                    side="right"
                    value={userData.deduplicator?.enabled ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        deduplicator: { ...prev.deduplicator, enabled: value },
                      }));
                    }}
                  />
                </SettingsCard>
                {mode === 'pro' && (
                  <>
                    <SettingsCard
                      title="Group Handling"
                      description={
                        <div>
                          Sets of duplicates are separated into groups based on
                          the streams' type. (e.g. cached, uncached, p2p, etc.)
                          These options control how each set of duplicates are
                          handled.
                        </div>
                      }
                    >
                      <div className="mt-2 space-y-2">
                        <div>
                          <span className="font-medium">Single Result</span>
                          <p className="text-sm text-[--muted] mt-1">
                            Keeps only one result from your highest priority
                            service and highest priority addon. If it is a P2P
                            or uncached result, it prioritises the number of
                            seeders over addon priority.
                          </p>
                        </div>
                        <div>
                          <span className="font-medium">Per Service</span>
                          <p className="text-sm text-[--muted] mt-1">
                            This keeps one result per service, and choses each
                            result using the same criteria above.
                          </p>
                        </div>
                        <div>
                          <span className="font-medium">Per Addon</span>
                          <p className="text-sm text-[--muted] mt-1">
                            This keeps one result per addon, and choses each
                            result from your highest priority service, and for
                            P2P/uncached results it looks at the number of
                            seeders.
                          </p>
                        </div>
                      </div>
                      <Select
                        disabled={!userData.deduplicator?.enabled}
                        label="Cached Results"
                        value={userData.deduplicator?.cached ?? 'disabled'}
                        options={[
                          { label: 'Disabled', value: 'disabled' },
                          { label: 'Single Result', value: 'single_result' },
                          { label: 'Per Service', value: 'per_service' },
                          { label: 'Per Addon', value: 'per_addon' },
                        ]}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            deduplicator: {
                              ...prev.deduplicator,
                              cached: value as
                                | 'single_result'
                                | 'per_service'
                                | 'per_addon'
                                | 'disabled',
                            },
                          }));
                        }}
                      />
                      <Select
                        disabled={!userData.deduplicator?.enabled}
                        label="Uncached Results"
                        value={userData.deduplicator?.uncached ?? 'disabled'}
                        options={[
                          { label: 'Disabled', value: 'disabled' },
                          { label: 'Single Result', value: 'single_result' },
                          { label: 'Per Service', value: 'per_service' },
                          { label: 'Per Addon', value: 'per_addon' },
                        ]}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            deduplicator: {
                              ...prev.deduplicator,
                              uncached: value as
                                | 'single_result'
                                | 'per_service'
                                | 'per_addon'
                                | 'disabled',
                            },
                          }));
                        }}
                      />
                      <Select
                        disabled={!userData.deduplicator?.enabled}
                        label="P2P Results"
                        value={userData.deduplicator?.p2p ?? 'disabled'}
                        options={[
                          { label: 'Disabled', value: 'disabled' },
                          { label: 'Single Result', value: 'single_result' },
                          { label: 'Per Service', value: 'per_service' },
                          { label: 'Per Addon', value: 'per_addon' },
                        ]}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            deduplicator: {
                              ...prev.deduplicator,
                              p2p: value as
                                | 'single_result'
                                | 'per_service'
                                | 'per_addon'
                                | 'disabled',
                            },
                          }));
                        }}
                      />
                    </SettingsCard>
                    <SettingsCard title="Other">
                      <Combobox
                        disabled={!userData.deduplicator?.enabled}
                        label="Detection Methods"
                        multiple
                        help="Select the methods used to detect duplicates"
                        value={
                          userData.deduplicator?.keys ?? [
                            'filename',
                            'infoHash',
                          ]
                        }
                        emptyMessage="No detection methods available"
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            deduplicator: {
                              ...prev.deduplicator,
                              keys: value as (typeof DEDUPLICATOR_KEYS)[number][],
                            },
                          }));
                        }}
                        options={DEDUPLICATOR_KEYS.map((key) => ({
                          label: key,
                          value: key,
                        }))}
                      />
                      <Combobox
                        help="Addons selected here will always have their results kept during deduplication."
                        label="Addon Exclusions"
                        value={userData.deduplicator?.excludeAddons ?? []}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            deduplicator: {
                              ...prev.deduplicator,
                              excludeAddons: value,
                            },
                          }));
                        }}
                        options={userData.presets.map((preset) => ({
                          label: preset.options.name || preset.type,
                          value: preset.instanceId,
                          textValue: preset.options.name,
                        }))}
                        emptyMessage="You haven't installed any addons..."
                        placeholder="Select addons..."
                        multiple
                        disabled={userData.deduplicator?.enabled === false}
                      />
                      <Select
                        label="Multi-Group Behaviour"
                        help={`Configure how duplicates across multiple types are handled. e.g. if a given duplicate set has both cached and uncached streams, what should be done.
                      ${deduplicatorMultiGroupBehaviourHelp[userData.deduplicator?.multiGroupBehaviour || defaultDeduplicatorMultiGroupBehaviour]}
                      `}
                        value={
                          userData.deduplicator?.multiGroupBehaviour ??
                          defaultDeduplicatorMultiGroupBehaviour
                        }
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            deduplicator: {
                              ...prev.deduplicator,
                              multiGroupBehaviour: value as
                                | 'conservative'
                                | 'aggressive'
                                | 'keep_all',
                            },
                          }));
                        }}
                        disabled={!userData.deduplicator?.enabled}
                        options={[
                          { label: 'Conservative', value: 'conservative' },
                          { label: 'Aggressive', value: 'aggressive' },
                          { label: 'Keep All', value: 'keep_all' },
                        ]}
                      />
                    </SettingsCard>
                  </>
                )}
              </div>
            </>
          </TabsContent>
          <TabsContent value="miscellaneous" className="space-y-4">
            <>
              <HeadingWithPageControls heading="Miscellaneous" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Additional miscellaneous filters.
                </p>
              </div>
              <div className="space-y-4">
                <SettingsCard
                  title="Digital Release Filter"
                  description="This will filter out all results for movies that are determined to not have a digital release."
                >
                  <Switch
                    label="Enabled"
                    side="right"
                    value={userData.digitalReleaseFilter?.enabled ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        digitalReleaseFilter: {
                          ...(prev.digitalReleaseFilter || {}),
                          enabled: value,
                        },
                      }));
                    }}
                  />
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Slider
                        label="Tolerance"
                        moreHelp="Ignore the digital release filter if the movie was released within this many days of the current date. This accounts for early releases, leaks, and server timezone differences."
                        disabled={!userData.digitalReleaseFilter?.enabled}
                        value={[userData.digitalReleaseFilter?.tolerance ?? 0]}
                        min={0}
                        max={365}
                        step={1}
                        defaultValue={[0]}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            digitalReleaseFilter: {
                              ...prev.digitalReleaseFilter,
                              tolerance: value[0],
                            },
                          }));
                        }}
                      />
                    </div>
                    <div className="w-24">
                      <NumberInput
                        label="Value"
                        step={1}
                        value={userData.digitalReleaseFilter?.tolerance ?? 0}
                        min={0}
                        max={365}
                        disabled={!userData.digitalReleaseFilter?.enabled}
                        onValueChange={(newValue) => {
                          if (newValue !== undefined) {
                            setUserData((prev) => ({
                              ...prev,
                              digitalReleaseFilter: {
                                ...prev.digitalReleaseFilter,
                                tolerance: newValue,
                              },
                            }));
                          }
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-[--muted]">Tolerance in days</p>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Combobox
                        multiple
                        disabled={!userData.digitalReleaseFilter?.enabled}
                        label="Request Types"
                        emptyMessage="There aren't any request types to choose from..."
                        help="Request types that will use the digital release filter. Leave blank to apply to all request types."
                        options={TYPES.map((type) => ({
                          label: type,
                          value: type,
                          textValue: type,
                        }))}
                        value={userData.digitalReleaseFilter?.requestTypes}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            digitalReleaseFilter: {
                              ...prev.digitalReleaseFilter,
                              requestTypes: value,
                            },
                          }));
                        }}
                      />
                      <Combobox
                        multiple
                        disabled={!userData.digitalReleaseFilter?.enabled}
                        label="Addons"
                        help="Addons that will use the digital release filter. Leave blank to apply to all addons."
                        emptyMessage="You haven't installed any addons yet..."
                        options={userData.presets.map((preset) => ({
                          label: preset.options.name || preset.type,
                          textValue: preset.options.name || preset.type,
                          value: preset.instanceId,
                        }))}
                        value={userData.digitalReleaseFilter?.addons || []}
                        onValueChange={(value) => {
                          setUserData((prev) => ({
                            ...prev,
                            digitalReleaseFilter: {
                              ...prev.digitalReleaseFilter,
                              addons: value,
                            },
                          }));
                        }}
                      />
                    </div>
                  </div>
                </SettingsCard>
                <SettingsCard
                  title="SeaDex Integration"
                  description="Fetch SeaDex data (releases.moe) for anime to identify best quality releases."
                >
                  <Switch
                    label="Enable"
                    side="right"
                    value={userData.enableSeadex ?? true}
                    defaultValue={true}
                    onValueChange={(value) => {
                      setUserData((prev) => ({ ...prev, enableSeadex: value }));
                    }}
                  />
                </SettingsCard>
                {mode === 'pro' && userData.excludeSeasonPacks && (
                  <SettingsCard
                    title="Exclude Season Packs"
                    description="Whether to filter out results that contain entire seasons."
                  >
                    <Switch
                      label="Enable"
                      side="right"
                      value={userData.excludeSeasonPacks}
                      onValueChange={(value) => {
                        setUserData((prev) => ({
                          ...prev,
                          excludeSeasonPacks: value,
                        }));
                      }}
                    />
                  </SettingsCard>
                )}
              </div>
            </>
          </TabsContent>
        </div>
      </Tabs>

      {/* Modal for Allowed Regex Patterns */}
      <Modal
        open={allowedRegexModal.isOpen}
        onOpenChange={allowedRegexModal.close}
        title="Allowed Regex Patterns"
        description="These are regex patterns that you are allowed to use in your filters."
      >
        <div className="space-y-4">
          <div className="border rounded-md bg-gray-900 border-gray-800 p-4 max-h-96 overflow-auto">
            <div className="space-y-2">
              {status?.settings.allowedRegexPatterns?.patterns.map(
                (pattern, index) => (
                  <div
                    key={index}
                    className="font-mono text-sm bg-gray-800 rounded px-3 py-2 break-all whitespace-pre-wrap"
                  >
                    {pattern}
                  </div>
                )
              )}
              {(!status?.settings.allowedRegexPatterns?.patterns ||
                status.settings.allowedRegexPatterns.patterns.length === 0) && (
                <div className="text-muted-foreground text-sm text-center">
                  No allowed regex patterns configured
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={whitelistedSelUrlsModal.isOpen}
        onOpenChange={whitelistedSelUrlsModal.close}
        title="Whitelisted Sync URLs"
        description="These are URLs that are whitelisted for syncing stream expressions."
      >
        <div className="space-y-4">
          <div className="border rounded-md bg-gray-900 border-gray-800 p-4 max-h-96 overflow-auto">
            <div className="space-y-2">
              {status?.settings.whitelistedSelUrls?.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 font-mono text-sm bg-gray-800 rounded px-3 py-2"
                >
                  <div className="flex-1 break-all whitespace-pre-wrap">
                    {url}
                  </div>
                  <IconButton
                    size="sm"
                    intent="primary-subtle"
                    icon={<FaRegCopy />}
                    onClick={() =>
                      copyToClipboard(url, {
                        successMessage: 'URL copied to clipboard',
                      })
                    }
                  />
                </div>
              ))}
              {(!status?.settings.whitelistedSelUrls ||
                status.settings.whitelistedSelUrls.length === 0) && (
                <div className="text-muted-foreground text-sm text-center">
                  No whitelisted sync URLs configured
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={allowedRegexUrlsModal.isOpen}
        onOpenChange={allowedRegexUrlsModal.close}
        title="Allowed Regex Pattern URLs"
        description="These are URLs that you can import regex patterns from."
      >
        <div className="space-y-4">
          <div className="border rounded-md bg-gray-900 border-gray-800 p-4 max-h-96 overflow-auto">
            <div className="space-y-2">
              {status?.settings.allowedRegexPatterns?.urls?.map(
                (url, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 font-mono text-sm bg-gray-800 rounded px-3 py-2"
                  >
                    <div className="flex-1 break-all whitespace-pre-wrap">
                      {url}
                    </div>
                    <IconButton
                      size="sm"
                      intent="primary-subtle"
                      icon={<FaRegCopy />}
                      onClick={() =>
                        copyToClipboard(url, {
                          successMessage: 'URL copied to clipboard',
                        })
                      }
                    />
                  </div>
                )
              )}
              {(!status?.settings.allowedRegexPatterns?.urls ||
                status.settings.allowedRegexPatterns.urls.length === 0) && (
                <div className="text-muted-foreground text-sm text-center">
                  No allowed regex pattern URLs configured
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
