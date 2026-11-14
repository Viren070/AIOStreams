import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterSignature, nameTest, resolveFilter } from './filter.js';
import { build, channelCount, nameOf } from './lineup.js';

const NONE = {
  excludeGroups: [],
  includeGroups: [],
  excludeChannels: [],
  includeChannels: [],
  cleanNames: false,
};

const categories = [
  { category_id: '1', category_name: 'UK | News' },
  { category_id: '2', category_name: 'US | PPV Events' },
  { category_id: '3', category_name: 'Sports' },
];
const streams = [
  { stream_id: 1, name: 'BBC News', category_id: '1' },
  { stream_id: 2, name: 'UFC 300', category_id: '2' },
  { stream_id: 3, name: 'Sky Sports', category_id: '3' },
  { stream_id: 4, name: 'Sky Sports PPV', category_id: '3' },
  { stream_id: 5, name: 'Boxing', category_ids: ['2', '3'] },
  { stream_id: 6, name: 'No Group' },
];
const names = (filter: Partial<typeof NONE>) => {
  const lineup = build({}, categories, streams, { ...NONE, ...filter });
  return {
    lineup,
    channels: Array.from({ length: channelCount(lineup) }, (_, i) =>
      nameOf(lineup, i)
    ),
  };
};

describe('nameTest', () => {
  it('matches keywords anywhere in the name, ignoring case', () => {
    const keep = nameTest(['ppv'], []);
    assert.equal(keep('US | PPV Events'), false);
    assert.equal(keep('UK | News'), true);
  });
  it('keeps only includes when given, with excludes winning', () => {
    const keep = nameTest(['adult'], ['uk', 'us']);
    assert.equal(keep('UK | News'), true);
    assert.equal(keep('UK | Adult'), false);
    assert.equal(keep('FR | News'), false);
  });
});

describe('resolveFilter', () => {
  it('accepts comma-separated text and arrays, trimmed', () => {
    const filter = resolveFilter(
      { excludeGroups: ' PPV , ,ADULT', includeChannels: ['x '] },
      {}
    );
    assert.deepEqual(filter.excludeGroups, ['PPV', 'ADULT']);
    assert.deepEqual(filter.includeChannels, ['x']);
  });
  it('uses the instance default only for lists the login leaves empty', () => {
    const filter = resolveFilter(
      { excludeGroups: ['mine'], excludeChannels: [] },
      { excludeGroups: 'ppv', excludeChannels: 'radio, tv' }
    );
    assert.deepEqual(filter.excludeGroups, ['mine']);
    assert.deepEqual(filter.excludeChannels, ['radio', 'tv']);
  });
  it('gives equal signatures for equal filters regardless of order or case', () => {
    assert.equal(
      filterSignature({ ...NONE, excludeGroups: ['A', 'b'] }),
      filterSignature({ ...NONE, excludeGroups: ['B', 'a'] })
    );
    assert.notEqual(
      filterSignature(NONE),
      filterSignature({ ...NONE, excludeGroups: ['a'] })
    );
  });
});

describe('build with a filter', () => {
  it('keeps everything without one', () => {
    assert.equal(names({}).channels.length, 6);
  });
  it('hides excluded groups and channels only in them', () => {
    const { lineup, channels } = names({ excludeGroups: ['ppv'] });
    assert.deepEqual(lineup.groups, ['UK | News', 'Sports']);
    assert.ok(!channels.includes('UFC 300'));
    // still in Sports, so it stays, and ungrouped channels are untouched
    assert.ok(channels.includes('Boxing'));
    assert.ok(channels.includes('No Group'));
  });
  it('limits to included groups, dropping ungrouped channels', () => {
    const { lineup, channels } = names({ includeGroups: ['news'] });
    assert.deepEqual(lineup.groups, ['UK | News']);
    assert.deepEqual(channels, ['BBC News']);
  });
  it('hides excluded channels and drops groups left empty', () => {
    const { lineup, channels } = names({ excludeChannels: ['news', 'ufc'] });
    assert.ok(!channels.includes('BBC News'));
    assert.ok(!lineup.groups.includes('UK | News'));
    // Boxing keeps the PPV group alive
    assert.ok(lineup.groups.includes('US | PPV Events'));
  });
  it('limits to included channels', () => {
    assert.deepEqual(names({ includeChannels: ['sky'] }).channels, [
      'Sky Sports',
      'Sky Sports PPV',
    ]);
  });
});

describe('build with clean names', () => {
  const tagged = [
    { stream_id: 1, name: 'UK | BBC One', category_id: '1' },
    { stream_id: 2, name: 'US | CNN', category_id: '1' },
  ];
  const channelsOf = (filter: Partial<typeof NONE>) => {
    const lineup = build({}, categories, tagged, { ...NONE, ...filter });
    return Array.from({ length: channelCount(lineup) }, (_, i) =>
      nameOf(lineup, i)
    );
  };
  it('strips the tags only when asked', () => {
    assert.deepEqual(channelsOf({}), ['UK | BBC One', 'US | CNN']);
    assert.deepEqual(channelsOf({ cleanNames: true }), ['BBC One', 'CNN']);
  });
  it('filters on the full name', () => {
    assert.deepEqual(
      channelsOf({ cleanNames: true, excludeChannels: ['us |'] }),
      ['BBC One']
    );
  });
  it('is part of the cache identity', () => {
    assert.notEqual(
      filterSignature(NONE),
      filterSignature({ ...NONE, cleanNames: true })
    );
  });
});
