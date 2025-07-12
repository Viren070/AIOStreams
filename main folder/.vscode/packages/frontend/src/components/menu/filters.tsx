'use client';
import { useEffect, useRef, useState } from 'react';
import { PageWrapper } from '../shared/page-wrapper';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { cn } from '../ui/core/styling';
import { SettingsNavCard } from '../shared/settings-card';
import { useUserData } from '@/context/userData';
import {
  FaBolt,
  FaFilm,
  FaHourglassStart,
  FaLanguage,
  FaTrash,
  FaPlus,
  FaRegTrashAlt,
  FaFileExport,
  FaFileImport,
  FaEquals,
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
} from 'react-icons/md';
import { BiSolidCameraMovie } from 'react-icons/bi';
import { SiDolby } from 'react-icons/si';
import { BsRegex, BsSpeakerFill } from 'react-icons/bs';
import { GoContainer, GoFileBinary } from 'react-icons/go';
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Select } from '../ui/select';
import { Combobox } from '../ui/combobox';
import { SettingsCard } from '../shared/settings-card';
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
} from '../../../../core/src/utils/constants';
import { PageControls } from '../shared/page-controls';
import { Switch } from '../ui/switch';
import { useStatus } from '@/context/status';
import { NumberInput } from '../ui/number-input';
import { IconButton, Button } from '../ui/button';
import { TextInput } from '../ui/text-input';
import { Tooltip } from '../ui/tooltip';
import { Alert } from '../ui/alert';
import { Modal } from '../ui/modal';
import { useDisclosure } from '@/hooks/disclosure';
import { toast } from 'sonner';
import { Slider } from '../ui/slider/slider';
import { TbFilterCode } from 'react-icons/tb';
import { PasswordInput } from '../ui/password-input';

type Resolution = (typeof RESOLUTIONS)[number];
type Quality = (typeof QUALITIES)[number];
type Encode = (typeof ENCODES)[number];
type StreamType = (typeof STREAM_TYPES)[number];
type VisualTag = (typeof VISUAL_TAGS)[number];
type AudioTag = (typeof AUDIO_TAGS)[number];
type AudioChannel = (typeof AUDIO_CHANNELS)[number];
type Language = (typeof LANGUAGES)[number];

const defaultPreferredResolutions: Resolution[] = [
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
  '240p',
  '144p',
  'Unknown',
];

const defaultPreferredQualities: Quality[] = [
  'BluRay REMUX',
  'BluRay',
  'WEB-DL',
  'WEBRip',
  'HDRip',
  'HC HD-Rip',
  'DVDRip',
  'HDTV',
  'CAM',
  'TS',
  'TC',
  'SCR',
  'Unknown',
];

const defaultPreferredEncodes: Encode[] = [];

const defaultPreferredStreamTypes: StreamType[] = [];

const defaultPreferredVisualTags: VisualTag[] = [];

const defaultPreferredAudioTags: AudioTag[] = [];

const tabsRootClass = cn(
  'w-full grid grid-cols-1 lg:grid lg:grid-cols-[300px,1fr] gap-4'
);

const tabsTriggerClass = cn(
  'font-bold text-base px-6 rounded-[--radius-md] w-fit lg:w-full border-none data-[state=active]:bg-[--subtle] data-[state=active]:text-white dark:hover:text-white',
  'h-10 lg:justify-start px-3'
);

const tabsListClass = cn(
  'w-full flex flex-wrap lg:flex-nowrap h-fit xl:h-10',
  'lg:block'
);

interface SizeFilterOptions {
  global?: {
    series?: [number, number];
    movies?: [number, number];
  };
  resolution?: {
    [key: string]: {
      movies?: [number, number];
      series?: [number, number];
    };
  };
}

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
  useEffect(() => {
    if (tab !== previousTab.current) {
      previousTab.current = tab;
    }
  }, [tab]);

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
      >
        <TabsList className="flex-wrap max-w-full lg:space-y-2">
          <SettingsNavCard>
            <div className="flex flex-col gap-4 md:flex-row justify-between items-center">
              <div className="space-y-1 my-2 px-2">
                <h4 className="text-center md:text-left">Filters</h4>
              </div>
              <div></div>
            </div>

            <div className="overflow-x-none lg:overflow-y-hidden overflow-y-scroll h-40 lg:h-auto rounded-[--radius-md] border lg:border-none">
              <TabsTrigger value="cache">
                <FaBolt className="text-lg mr-3" />
                Cache
              </TabsTrigger>
              <TabsTrigger value="resolution">
                <BiSolidCameraMovie className="text-lg mr-3" />
                Resolution
              </TabsTrigger>
              <TabsTrigger value="quality">
                <MdMovieFilter className="text-lg mr-3" />
                Quality
              </TabsTrigger>
              <TabsTrigger value="encode">
                <FaFilm className="text-lg mr-3" />
                Encode
              </TabsTrigger>
              <TabsTrigger value="stream-type">
                <MdVideoLibrary className="text-lg mr-3" />
                Stream Type
              </TabsTrigger>
              <TabsTrigger value="visual-tag">
                <MdHdrOn className="text-lg mr-3" />
                Visual Tag
              </TabsTrigger>
              <TabsTrigger value="audio-tag">
                <BsSpeakerFill className="text-lg mr-3" />
                Audio Tag
              </TabsTrigger>
              <TabsTrigger value="audio-channel">
                <MdSurroundSound className="text-lg mr-3" />
                Audio Channel
              </TabsTrigger>
              <TabsTrigger value="language">
                <FaLanguage className="text-lg mr-3" />
                Language
              </TabsTrigger>
              <TabsTrigger value="seeders">
                <MdPerson className="text-lg mr-3" />
                Seeders
              </TabsTrigger>
              <TabsTrigger value="title-matching">
                <FaEquals className="text-lg mr-3" />
                Matching
              </TabsTrigger>
              <TabsTrigger value="keyword">
                <MdTextFields className="text-lg mr-3" />
                Keyword
              </TabsTrigger>
              <TabsTrigger value="stream-expression">
                <TbFilterCode className="text-lg mr-3" />
                Stream Expression
              </TabsTrigger>
              {status?.settings.regexFilterAccess !== 'none' && (
                <TabsTrigger value="regex">
                  <BsRegex className="text-lg mr-3" />
                  Regex
                </TabsTrigger>
              )}
              <TabsTrigger value="size">
                <GoFileBinary className="text-lg mr-3" />
                Size
              </TabsTrigger>
              <TabsTrigger value="limit">
                <GoContainer className="text-lg mr-3" />
                Result Limits
              </TabsTrigger>
              <TabsTrigger value="deduplicator">
                <MdCleaningServices className="text-lg mr-3" />
                Deduplicator
              </TabsTrigger>
            </div>
          </SettingsNavCard>
        </TabsList>

        <div className="space-y-0 relative">
          <TabsContent value="cache" className="space-y-4">
            <PageWrapper>
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
                          excludeUncachedFromStreamTypes: value as StreamType[],
                        }));
                      }}
                      options={STREAM_TYPES.filter(
                        (streamType) =>
                          ['debrid', 'usenet'].includes(streamType) // only these 2 stream types can have a service
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
                          excludeCachedFromStreamTypes: value as StreamType[],
                        }));
                      }}
                      options={STREAM_TYPES.filter(
                        (streamType) =>
                          ['debrid', 'usenet'].includes(streamType) // only these 2 stream types can have a service
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
                  </div>
                </SettingsCard>
              </div>
            </PageWrapper>
          </TabsContent>

          <TabsContent value="resolution" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Resolution" />
              <FilterSettings<Resolution>
                filterName="Resolutions"
                preferredOptions={
                  userData.preferredResolutions || defaultPreferredResolutions
                }
                requiredOptions={userData.requiredResolutions || []}
                excludedOptions={userData.excludedResolutions || []}
                includedOptions={userData.includedResolutions || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredResolutions: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredResolutions: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedResolutions: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedResolutions: included,
                  }));
                }}
                options={RESOLUTIONS.map((resolution) => ({
                  name: resolution,
                  value: resolution,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="quality" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Quality" />
              <FilterSettings<Quality>
                filterName="Qualities"
                preferredOptions={
                  userData.preferredQualities || defaultPreferredQualities
                }
                requiredOptions={userData.requiredQualities || []}
                excludedOptions={userData.excludedQualities || []}
                includedOptions={userData.includedQualities || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredQualities: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredQualities: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedQualities: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedQualities: included,
                  }));
                }}
                options={QUALITIES.map((quality) => ({
                  name: quality,
                  value: quality,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="encode" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Encode" />
              <FilterSettings<Encode>
                filterName="Encodes"
                preferredOptions={
                  userData.preferredEncodes || defaultPreferredEncodes
                }
                requiredOptions={userData.requiredEncodes || []}
                excludedOptions={userData.excludedEncodes || []}
                includedOptions={userData.includedEncodes || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredEncodes: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredEncodes: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedEncodes: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedEncodes: included,
                  }));
                }}
                options={ENCODES.map((encode) => ({
                  name: encode,
                  value: encode,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="stream-type" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Stream Type" />
              <FilterSettings<StreamType>
                filterName="Stream Types"
                preferredOptions={
                  userData.preferredStreamTypes || defaultPreferredStreamTypes
                }
                requiredOptions={userData.requiredStreamTypes || []}
                excludedOptions={userData.excludedStreamTypes || []}
                includedOptions={userData.includedStreamTypes || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredStreamTypes: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredStreamTypes: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedStreamTypes: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedStreamTypes: included,
                  }));
                }}
                options={STREAM_TYPES.map((streamType) => ({
                  name: streamType,
                  value: streamType,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="visual-tag" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Visual Tag" />
              <FilterSettings<VisualTag>
                filterName="Visual Tags"
                preferredOptions={
                  userData.preferredVisualTags || defaultPreferredVisualTags
                }
                requiredOptions={userData.requiredVisualTags || []}
                excludedOptions={userData.excludedVisualTags || []}
                includedOptions={userData.includedVisualTags || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredVisualTags: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredVisualTags: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedVisualTags: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedVisualTags: included,
                  }));
                }}
                options={VISUAL_TAGS.map((visualTag) => ({
                  name: visualTag,
                  value: visualTag,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="audio-tag" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Audio Tag" />
              <FilterSettings<AudioTag>
                filterName="Audio Tags"
                preferredOptions={userData.preferredAudioTags || []}
                requiredOptions={userData.requiredAudioTags || []}
                excludedOptions={userData.excludedAudioTags || []}
                includedOptions={userData.includedAudioTags || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredAudioTags: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredAudioTags: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedAudioTags: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedAudioTags: included,
                  }));
                }}
                options={AUDIO_TAGS.map((audioTag) => ({
                  name: audioTag,
                  value: audioTag,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="audio-channel" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Audio Channel" />
              <FilterSettings<AudioChannel>
                filterName="Audio Channels"
                preferredOptions={userData.preferredAudioChannels || []}
                requiredOptions={userData.requiredAudioChannels || []}
                excludedOptions={userData.excludedAudioChannels || []}
                includedOptions={userData.includedAudioChannels || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredAudioChannels: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredAudioChannels: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedAudioChannels: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedAudioChannels: included,
                  }));
                }}
                options={AUDIO_CHANNELS.map((audioChannel) => ({
                  name: audioChannel,
                  value: audioChannel,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="language" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Language" />
              <FilterSettings<Language>
                filterName="Languages"
                preferredOptions={userData.preferredLanguages || []}
                requiredOptions={userData.requiredLanguages || []}
                excludedOptions={userData.excludedLanguages || []}
                includedOptions={userData.includedLanguages || []}
                onPreferredChange={(preferred) => {
                  setUserData((prev) => ({
                    ...prev,
                    preferredLanguages: preferred,
                  }));
                }}
                onRequiredChange={(required) => {
                  setUserData((prev) => ({
                    ...prev,
                    requiredLanguages: required,
                  }));
                }}
                onExcludedChange={(excluded) => {
                  setUserData((prev) => ({
                    ...prev,
                    excludedLanguages: excluded,
                  }));
                }}
                onIncludedChange={(included) => {
                  setUserData((prev) => ({
                    ...prev,
                    includedLanguages: included,
                  }));
                }}
                options={LANGUAGES.map((language) => ({
                  name: language
                    .split(' ')
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' '),
                  value: language,
                }))}
              />
            </PageWrapper>
          </TabsContent>
          <TabsContent value="seeders" className="space-y-4">
            <PageWrapper>
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
                              excludeSeederRange: [newValue[0], newValue[1]],
                            }))
                          }
                          minStepsBetweenThumbs={1}
                          label="Excluded Seeder Range"
                          help="Streams with seeders in this range will be excluded"
                        />
                        <div className="flex justify-between mt-1 text-xs text-[--muted]">
                          <span>
                            {userData.excludeSeederRange?.[0] || MIN_SEEDERS}
                          </span>
                          <span>
                            {userData.excludeSeederRange?.[1] || MAX_SEEDERS}
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
                          max={userData.excludeSeederRange?.[1] || MAX_SEEDERS}
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
                          min={userData.excludeSeederRange?.[0] || MIN_SEEDERS}
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
                              includeSeederRange: [newValue[0], newValue[1]],
                            }))
                          }
                          minStepsBetweenThumbs={1}
                          label="Included Seeder Range"
                          help="Streams with seeders in this range will be included, ignoring ANY other exclude/required filters, not just for this filter"
                        />
                        <div className="flex justify-between mt-1 text-xs text-[--muted]">
                          <span>
                            {userData.includeSeederRange?.[0] || MIN_SEEDERS}
                          </span>
                          <span>
                            {userData.includeSeederRange?.[1] || MAX_SEEDERS}
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
                          max={userData.includeSeederRange?.[1] || MAX_SEEDERS}
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
                          min={userData.includeSeederRange?.[0] || MIN_SEEDERS}
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
            </PageWrapper>
          </TabsContent>
          <TabsContent value="title-matching" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Matching" />
              <div className="space-y-4">
                <SettingsCard
                  title="Title Matching"
                  description="Any streams which don't specifically match the requested title will be filtered out. You can optionally choose to only apply it to specific request types and addons"
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

                  <Switch
                    label="Match Year"
                    side="right"
                    disabled={!userData.titleMatching?.enabled}
                    value={userData.titleMatching?.matchYear ?? false}
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        titleMatching: {
                          ...prev.titleMatching,
                          matchYear: value,
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

                  <PasswordInput
                    label="TMDB Access Token"
                    help={
                      <>
                        <p>
                          A TMDB access token is required to fetch titles from
                          the TMDB API. You can get it from your{' '}
                          <a
                            href="https://www.themoviedb.org/settings/api"
                            target="_blank"
                            className="text-[--brand] hover:underline"
                            rel="noopener noreferrer"
                          >
                            TMDB Account Settings
                          </a>
                        </p>
                        <p></p>
                      </>
                    }
                    disabled={!userData.titleMatching?.enabled}
                    required={!status?.settings.tmdbApiAvailable}
                    value={userData.tmdbAccessToken}
                    placeholder="Enter your TMDB access token"
                    onValueChange={(value) => {
                      setUserData((prev) => ({
                        ...prev,
                        tmdbAccessToken: value,
                      }));
                    }}
                  />

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
            </PageWrapper>
          </TabsContent>
          <TabsContent value="stream-expression" className="space-y-4">
            <PageWrapper>
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
                          Apply conditional logic using ternary operators
                          <code>expression ? arrayIfTrue : arrayIfFalse</code>
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
                <TextInputs
                  label="Required Stream Expressions"
                  itemName="Expression"
                  help="The expressions to apply to the streams. Streams selected by any of these expressions will be required to be in the results."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.requiredStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredStreamExpressions: values,
                    }));
                  }}
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredStreamExpressions: [
                        ...(prev.requiredStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        value,
                        ...(prev.requiredStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                />
                <TextInputs
                  label="Excluded Stream Expressions"
                  itemName="Expression"
                  help="The expressions to apply to the streams. Streams selected by any of these expressions will be excluded from the results."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.excludedStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedStreamExpressions: values,
                    }));
                  }}
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedStreamExpressions: [
                        ...(prev.excludedStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        value,
                        ...(prev.excludedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                />
                <TextInputs
                  label="Included Stream Expressions"
                  itemName="Expression"
                  help="The expressions to apply to the streams. Streams selected by any of these expressions will be included in the results."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.includedStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedStreamExpressions: values,
                    }));
                  }}
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedStreamExpressions: [
                        ...(prev.includedStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        value,
                        ...(prev.includedStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                />
                <TextInputs
                  label="Preferred Stream Expressions"
                  itemName="Expression"
                  help="The expressions to apply to the streams. Streams selected by these expressions will be preferred over other streams and ranked by the order they are in this list."
                  placeholder="addon(type(streams, 'debrid'), 'TorBox')"
                  values={userData.preferredStreamExpressions || []}
                  onValuesChange={(values) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredStreamExpressions: values,
                    }));
                  }}
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredStreamExpressions: [
                        ...(prev.preferredStreamExpressions || []).slice(
                          0,
                          index
                        ),
                        value,
                        ...(prev.preferredStreamExpressions || []).slice(
                          index + 1
                        ),
                      ],
                    }));
                  }}
                />
              </div>
            </PageWrapper>
          </TabsContent>
          <TabsContent value="keyword" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Keyword" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Filter your streams by keywords - words or phrases that must
                  appear in the filename, folder name, indexer, or release group
                </p>
              </div>
              <div className="space-y-4">
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredKeywords: [
                        ...(prev.requiredKeywords || []).slice(0, index),
                        value,
                        ...(prev.requiredKeywords || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedKeywords: [
                        ...(prev.excludedKeywords || []).slice(0, index),
                        value,
                        ...(prev.excludedKeywords || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedKeywords: [
                        ...(prev.includedKeywords || []).slice(0, index),
                        value,
                        ...(prev.includedKeywords || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      preferredKeywords: [
                        ...(prev.preferredKeywords || []).slice(0, index),
                        value,
                        ...(prev.preferredKeywords || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
              </div>
            </PageWrapper>
          </TabsContent>
          <TabsContent value="regex" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Regex" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Filter your streams by regular expressions that must match one
                  of the following: filename, folder name, indexer, or release
                  group
                </p>
              </div>
              <div className="mb-4">
                {status?.settings.regexFilterAccess === 'trusted' && (
                  <Alert
                    intent="info"
                    title="Admin Only"
                    description={
                      <>
                        <p>
                          Regex filters are only available to trusted users due
                          to the potential for abuse. Ask the owner of the
                          instance to add your UUID to the{' '}
                          <code className="font-mono">TRUSTED_UUIDS</code>{' '}
                          environment variable.
                        </p>
                      </>
                    }
                  />
                )}
              </div>
              <div className="space-y-4">
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      requiredRegexPatterns: [
                        ...(prev.requiredRegexPatterns || []).slice(0, index),
                        value,
                        ...(prev.requiredRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      excludedRegexPatterns: [
                        ...(prev.excludedRegexPatterns || []).slice(0, index),
                        value,
                        ...(prev.excludedRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
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
                  onValueChange={(value, index) => {
                    setUserData((prev) => ({
                      ...prev,
                      includedRegexPatterns: [
                        ...(prev.includedRegexPatterns || []).slice(0, index),
                        value,
                        ...(prev.includedRegexPatterns || []).slice(index + 1),
                      ],
                    }));
                  }}
                />
                <TwoTextInputs
                  title="Preferred Regex Patterns"
                  description="Define regex patterns with names for easy reference"
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
              </div>
            </PageWrapper>
          </TabsContent>
          <TabsContent value="size" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Size" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Set minimum and maximum size limits for movies and series. You
                  can set a global limit, and also choose to set specific limits
                  for each resolution. For a given stream, only one set of size
                  filters would be used. A resolution specific limit takes
                  priority.
                </p>
              </div>
              <div className="space-y-4">
                <SettingsCard
                  title="Global"
                  description="Apply size filters for movies and series"
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
                  />
                </SettingsCard>

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
                      />
                    ))}
                  </div>
                </SettingsCard>
              </div>
            </PageWrapper>
          </TabsContent>
          <TabsContent value="limit" className="space-y-4">
            <PageWrapper>
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
                </div>
              </SettingsCard>
            </PageWrapper>
          </TabsContent>
          <TabsContent value="deduplicator" className="space-y-4">
            <PageWrapper>
              <HeadingWithPageControls heading="Deduplicator" />
              <div className="mb-4">
                <p className="text-sm text-[--muted]">
                  Enable and customise the removal of duplicate results
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

                <SettingsCard>
                  <Combobox
                    disabled={!userData.deduplicator?.enabled}
                    label="Detection Methods"
                    multiple
                    help="Select the methods used to detect duplicates"
                    value={
                      userData.deduplicator?.keys ?? ['filename', 'infoHash']
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
                </SettingsCard>

                <SettingsCard title="Deduplicator Settings">
                  <p className="text-sm text-[--muted]">
                    Configure how results are deduplicated for each result type:
                  </p>
                  <div className="mt-2 space-y-2">
                    <div>
                      <span className="font-medium">Single Result</span>
                      <p className="text-sm text-[--muted] mt-1">
                        Keeps only one result from your highest priority service
                        and highest priority addon. If it is a P2P or uncached
                        result, it prioritises the number of seeders over addon
                        priority.
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
                        This keeps one result per addon, and choses each result
                        from your highest priority service, and for P2P/uncached
                        results it looks at the number of seeders.
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
              </div>
            </PageWrapper>
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}

// component for general 3 settings - excluded, required, and preferred.
// the component should have 3 combo boxes, accept names and descriptions as parameters, and provide
// onPreferredChange, onRequiredChange, and onExcludedChange callbacks.
// The 3rd combo box for preferred should have the options to prefer specific values, but the actual
// array should be generated using a DragabbleContext

// the values selected in the combobox for preferred would be the only options displayed in the sortable list.
// and of course, the onPreferredChange callback is only used in the sortable list, not the combo box.
// other callbacks are used in the combo box.

type FilterSettingsProps<T extends string> = {
  filterName: string;
  preferredOptions: T[];
  requiredOptions: T[];
  excludedOptions: T[];
  includedOptions: T[];
  onPreferredChange: (preferred: T[]) => void;
  onRequiredChange: (required: T[]) => void;
  onExcludedChange: (excluded: T[]) => void;
  onIncludedChange: (included: T[]) => void;
  options: { name: string; value: T }[]; // these 3 options are used for all 3 combo boxes
};

function FilterSettings<T extends string>({
  filterName,
  preferredOptions,
  requiredOptions,
  excludedOptions,
  includedOptions,
  onPreferredChange,
  onRequiredChange,
  onExcludedChange,
  onIncludedChange,
  options,
}: FilterSettingsProps<T>) {
  const [required, setRequired] = useState<T[]>(requiredOptions);
  const [excluded, setExcluded] = useState<T[]>(excludedOptions);
  const [preferred, setPreferred] = useState<T[]>(preferredOptions);
  const [included, setIncluded] = useState<T[]>(includedOptions);
  const [isDragging, setIsDragging] = useState(false);

  const filterToAllowedValues = (filter: T[]) => {
    return filter.filter((value) => options.some((opt) => opt.value === value));
  };

  useEffect(() => {
    setRequired(filterToAllowedValues(requiredOptions));
    setExcluded(filterToAllowedValues(excludedOptions));
    setPreferred(filterToAllowedValues(preferredOptions));
    setIncluded(filterToAllowedValues(includedOptions));
  }, [requiredOptions, excludedOptions, preferredOptions, includedOptions]);

  // DND logic
  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;
    if (active.id !== over.id) {
      const oldIndex = preferred.indexOf(active.id);
      const newIndex = preferred.indexOf(over.id);
      const newPreferred = arrayMove(preferred, oldIndex, newIndex);
      setPreferred(newPreferred);
      onPreferredChange(newPreferred);
    }
    setIsDragging(false);
  }

  function handleDragStart(event: any) {
    setIsDragging(true);
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  );

  useEffect(() => {
    function preventTouchMove(e: TouchEvent) {
      if (isDragging) {
        e.preventDefault();
      }
    }

    function handleDragEnd() {
      setIsDragging(false);
    }

    if (isDragging) {
      document.body.addEventListener('touchmove', preventTouchMove, {
        passive: false,
      });
      document.addEventListener('pointerup', handleDragEnd);
      document.addEventListener('touchend', handleDragEnd);
    } else {
      document.body.removeEventListener('touchmove', preventTouchMove);
    }

    return () => {
      document.body.removeEventListener('touchmove', preventTouchMove);
      document.removeEventListener('pointerup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  return (
    <div className="space-y-6">
      <SettingsCard
        title={`${filterName} Selection`}
        description={`Configure required, excluded, and preferred ${filterName.toLowerCase()}`}
      >
        <div className="space-y-4">
          <div>
            <Combobox
              label={`Required ${filterName}`}
              help={`Any stream that is not one of the required ${filterName.toLowerCase()} will be excluded.`}
              value={required}
              onValueChange={(values) => {
                setRequired(values as T[]);
                onRequiredChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select required ${filterName.toLowerCase()}...`}
            />
          </div>
          <div>
            <Combobox
              label={`Excluded ${filterName}`}
              value={excluded}
              help={`Any stream that is one of the excluded ${filterName.toLowerCase()} will be excluded.`}
              onValueChange={(values) => {
                setExcluded(values as T[]);
                onExcludedChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select excluded ${filterName.toLowerCase()}...`}
            />
          </div>
          <div>
            <Combobox
              label={`Included ${filterName}`}
              value={included}
              help={`Included ${filterName.toLowerCase()} will be included regardless of ANY other exclude/required filters, not just for ${filterName.toLowerCase()}`}
              onValueChange={(values) => {
                setIncluded(values as T[]);
                onIncludedChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select included ${filterName.toLowerCase()}...`}
            />
          </div>
          <div>
            <Combobox
              label={`Preferred ${filterName}`}
              help={`Set preferred ${filterName.toLowerCase()} and control its order below. This is used if the relevant sort criterion is enabled in the Sorting section.`}
              value={preferred}
              onValueChange={(values) => {
                setPreferred(values as T[]);
                onPreferredChange(values as T[]);
              }}
              options={options.map((opt) => ({
                value: opt.value,
                label: opt.name,
                textValue: opt.name,
              }))}
              multiple
              emptyMessage={`No ${filterName.toLowerCase()} available`}
              placeholder={`Select preferred ${filterName.toLowerCase()}...`}
            />
          </div>
        </div>
      </SettingsCard>

      {preferred.length > 0 && (
        <SettingsCard
          title="Preference Order"
          description={`Drag to reorder your preferred ${filterName.toLowerCase()}`}
        >
          <DndContext
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            onDragStart={handleDragStart}
            sensors={sensors}
          >
            <SortableContext
              items={preferred}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {preferred.map((value) => (
                  <SortableFilterItem
                    key={value}
                    id={value}
                    name={
                      options.find((opt) => opt.value === value)?.name || value
                    }
                    onDelete={() => {
                      const newPreferred = preferred.filter((v) => v !== value);
                      setPreferred(newPreferred);
                      onPreferredChange(newPreferred);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </SettingsCard>
      )}
    </div>
  );
}

function SortableFilterItem({
  id,
  name,
  onDelete,
}: {
  id: string;
  name: string;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="px-2.5 py-2 bg-[var(--background)] rounded-[--radius-md] border flex gap-3 relative">
        <div
          className="rounded-full w-6 h-auto bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight] cursor-move"
          {...attributes}
          {...listeners}
        />
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="font-mono text-base truncate">{name}</span>
        </div>
        <div className="flex-shrink-0 ml-auto">
          <IconButton
            size="sm"
            rounded
            icon={<FaRegTrashAlt />}
            intent="alert-subtle"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function HeadingWithPageControls({ heading }: { heading: string }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
      <h3>{heading}</h3>
      <div className="hidden lg:block lg:ml-auto">
        <PageControls />
      </div>
    </div>
  );
}

type TextInputProps = {
  itemName: string; // what each item in the array is referred to as
  label: string; // label that shows above the actual inputs
  help: string; // help text that shows below the label
  values: string[];
  onValuesChange: (values: string[]) => void;
  onValueChange: (value: string, index: number) => void;
  placeholder?: string;
};

// a component controls an array of text inputs.
// and allows the user to add and remove values
function TextInputs({
  itemName,
  label,
  help,
  values,
  onValuesChange,
  onValueChange,
  placeholder,
}: TextInputProps) {
  const importModalDisclosure = useDisclosure(false);

  const handleImport = (data: any) => {
    if (Array.isArray(data.values)) {
      onValuesChange(data.values);
    } else {
      toast.error('Invalid import format');
    }
  };

  const handleExport = () => {
    const data = { values: values };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.toLowerCase().replace(/\s+/g, '-')}-values.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <SettingsCard title={label} description={help} key={label}>
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <div className="flex-1">
            <TextInput
              value={value}
              label={itemName}
              placeholder={placeholder}
              onValueChange={(value) => onValueChange(value, index)}
            />
          </div>
          <IconButton
            size="sm"
            rounded
            icon={<FaRegTrashAlt />}
            intent="alert-subtle"
            onClick={() =>
              onValuesChange([
                ...values.slice(0, index),
                ...values.slice(index + 1),
              ])
            }
          />
        </div>
      ))}
      <div className="mt-2 flex gap-2 items-center">
        <IconButton
          rounded
          size="sm"
          intent="primary-subtle"
          icon={<FaPlus />}
          onClick={() => onValuesChange([...values, ''])}
        />
        <div className="ml-auto flex gap-2">
          <Tooltip
            trigger={
              <IconButton
                rounded
                size="sm"
                intent="primary-subtle"
                icon={<FaFileImport />}
                onClick={importModalDisclosure.open}
              />
            }
          >
            Import
          </Tooltip>
          <Tooltip
            trigger={
              <IconButton
                rounded
                size="sm"
                intent="primary-subtle"
                icon={<FaFileExport />}
                onClick={handleExport}
              />
            }
          >
            Export
          </Tooltip>
        </div>
      </div>
      <ImportModal
        open={importModalDisclosure.isOpen}
        onOpenChange={importModalDisclosure.toggle}
        onImport={handleImport}
      />
    </SettingsCard>
  );
}

// similar to textInputs, but with two text inputs, and the output being an array of objects of
// the form {name: string, value: string}

type KeyValueInputProps = {
  title: string;
  description: string;
  keyId: string;
  keyName: string;
  keyPlaceholder: string;
  valueId: string;
  valueName: string;
  valuePlaceholder: string;
  values: { name: string; value: string }[];
  onValuesChange: (values: { name: string; value: string }[]) => void;
  onValueChange: (value: string, index: number) => void;
  onKeyChange: (key: string, index: number) => void;
};

function TwoTextInputs({
  title,
  description,
  keyName,
  keyId,
  keyPlaceholder,
  valueId,
  valueName,
  valuePlaceholder,
  values,
  onValuesChange,
  onValueChange,
  onKeyChange,
}: KeyValueInputProps) {
  const importModalDisclosure = useDisclosure(false);

  const handleImport = (data: any) => {
    if (
      Array.isArray(data) &&
      data.every(
        (value: { [key: string]: string }) =>
          typeof value[keyId] === 'string' && typeof value[valueId] === 'string'
      )
    ) {
      onValuesChange(
        data.map((v: { [key: string]: string }) => ({
          name: v[keyId],
          value: v[valueId],
        }))
      );
    } else {
      toast.error('Invalid import format');
    }
  };

  const handleExport = () => {
    const data = values.map((value) => ({
      [keyId]: value.name,
      [valueId]: value.value,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}-values.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <SettingsCard title={title} description={description}>
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <div className="flex-1">
            <TextInput
              value={value.name}
              label={keyName}
              placeholder={keyPlaceholder}
              onValueChange={(newValue) => onKeyChange(newValue, index)}
            />
          </div>
          <div className="flex-1">
            <TextInput
              value={value.value}
              label={valueName}
              placeholder={valuePlaceholder}
              onValueChange={(newValue) => onValueChange(newValue, index)}
            />
          </div>
          <IconButton
            size="sm"
            rounded
            icon={<FaRegTrashAlt />}
            intent="alert-subtle"
            onClick={() =>
              onValuesChange([
                ...values.slice(0, index),
                ...values.slice(index + 1),
              ])
            }
          />
        </div>
      ))}
      <div className="mt-2 flex gap-2 items-center">
        <IconButton
          rounded
          size="sm"
          intent="primary-subtle"
          icon={<FaPlus />}
          onClick={() => onValuesChange([...values, { name: '', value: '' }])}
        />
        <div className="ml-auto flex gap-2">
          <Tooltip
            trigger={
              <IconButton
                rounded
                size="sm"
                intent="primary-subtle"
                icon={<FaFileImport />}
                onClick={importModalDisclosure.open}
              />
            }
          >
            Import
          </Tooltip>
          <Tooltip
            trigger={
              <IconButton
                rounded
                size="sm"
                intent="primary-subtle"
                icon={<FaFileExport />}
                onClick={handleExport}
              />
            }
          >
            Export
          </Tooltip>
        </div>
      </div>
      <ImportModal
        open={importModalDisclosure.isOpen}
        onOpenChange={importModalDisclosure.toggle}
        onImport={handleImport}
      />
    </SettingsCard>
  );
}

function ImportModal({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (data: any) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlModalDisclosure = useDisclosure(false);
  const [url, setUrl] = useState('');

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        onImport(data);
        onOpenChange(false);
      } catch (error) {
        console.error('Error importing file:', error);
        toast.error('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUrlImport = async () => {
    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch URL');
      }
      const data = await response.json();
      onImport(data);
      urlModalDisclosure.close();
      onOpenChange(false);
    } catch (error) {
      console.error('Error importing from URL:', error);
      toast.error('Failed to import from URL');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title="Import">
        <div className="space-y-4">
          <div className="flex flex-col gap-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileImport}
              accept=".json"
              className="hidden"
            />
            <Button
              intent="primary"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              Import from File
            </Button>
            <Button
              intent="primary"
              onClick={urlModalDisclosure.open}
              className="w-full"
            >
              Import from URL
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={urlModalDisclosure.isOpen}
        onOpenChange={urlModalDisclosure.close}
        title="Import from URL"
      >
        <div className="space-y-4">
          <TextInput
            label="URL"
            value={url}
            onValueChange={setUrl}
            placeholder="Enter URL to JSON file"
          />
          <div className="flex justify-end gap-2">
            <Button intent="primary-outline" onClick={urlModalDisclosure.close}>
              Cancel
            </Button>
            <Button
              intent="primary"
              onClick={handleUrlImport}
              loading={isLoading}
            >
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

interface SizeRangeSliderProps {
  label: string;
  help?: string;
  moviesValue: [number, number];
  seriesValue: [number, number];
  onMoviesChange: (value: [number, number]) => void;
  onSeriesChange: (value: [number, number]) => void;
  min?: number;
  max?: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function SizeRangeSlider({
  label,
  help,
  moviesValue,
  seriesValue,
  onMoviesChange,
  onSeriesChange,
  min = MIN_SIZE,
  max = MAX_SIZE,
}: SizeRangeSliderProps) {
  return (
    <div className="space-y-6">
      <h4 className="text-base font-medium">{label}</h4>

      {/* Movies Slider */}
      <div className="space-y-2">
        <h5 className="text-sm font-medium text-[--muted]">Movies</h5>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 min-w-0">
            <Slider
              min={min}
              max={max}
              defaultValue={[min, max]}
              step={max / 1000}
              value={moviesValue}
              onValueChange={(newValue) =>
                newValue !== undefined &&
                newValue?.[0] !== undefined &&
                newValue?.[1] !== undefined &&
                onMoviesChange([newValue[0], newValue[1]])
              }
              minStepsBetweenThumbs={1}
              label="Movies Size Range"
              help={help}
            />
            <div className="flex justify-between mt-1 text-xs text-[--muted]">
              <span>{formatBytes(moviesValue[0])}</span>
              <span>{formatBytes(moviesValue[1])}</span>
            </div>
          </div>
          <div className="flex gap-2 md:w-[240px] shrink-0">
            <NumberInput
              label="Min"
              step={max / 1000}
              value={moviesValue[0]}
              min={min}
              max={moviesValue[1]}
              onValueChange={(newValue) =>
                newValue !== undefined &&
                onMoviesChange([newValue, moviesValue[1]])
              }
            />
            <NumberInput
              label="Max"
              step={max / 1000}
              value={moviesValue[1]}
              min={moviesValue[0]}
              max={max}
              onValueChange={(newValue) =>
                newValue !== undefined &&
                onMoviesChange([moviesValue[0], newValue])
              }
            />
          </div>
        </div>
      </div>

      {/* Series Slider */}
      <div className="space-y-2">
        <h5 className="text-sm font-medium text-[--muted]">Series</h5>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 min-w-0">
            <Slider
              min={min}
              max={max}
              step={max / 1000}
              defaultValue={[min, max]}
              value={seriesValue}
              onValueChange={(newValue) =>
                newValue !== undefined &&
                newValue?.[0] !== undefined &&
                newValue?.[1] !== undefined &&
                onSeriesChange([newValue[0], newValue[1]])
              }
              minStepsBetweenThumbs={1}
              label="Series Size Range"
              help={help}
            />
            <div className="flex justify-between mt-1 text-xs text-[--muted]">
              <span>{formatBytes(seriesValue[0])}</span>
              <span>{formatBytes(seriesValue[1])}</span>
            </div>
          </div>
          <div className="flex gap-2 md:w-[240px] shrink-0">
            <NumberInput
              label="Min"
              step={max / 1000}
              value={seriesValue[0]}
              min={min}
              max={seriesValue[1]}
              onValueChange={(newValue) =>
                newValue !== undefined &&
                onSeriesChange([newValue, seriesValue[1]])
              }
            />
            <NumberInput
              label="Max"
              step={max / 1000}
              value={seriesValue[1]}
              min={seriesValue[0]}
              max={max}
              onValueChange={(newValue) =>
                newValue !== undefined &&
                onSeriesChange([seriesValue[0], newValue])
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
