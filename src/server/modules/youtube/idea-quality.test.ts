import { describe, expect, it } from 'vitest';
import type { YoutubeIdeaV2 } from '../../../contracts/youtube-ideas';
import {
  YOUTUBE_IDEA_AVOID_LISTS,
  auditYoutubeIdeaClaimCoverage,
  filterYoutubeIdeaSeeds,
  isYoutubeIdeaPeriodRefinement,
  normalizeYoutubeIdeaStageOutput,
  trimYoutubeIdeaV2Final,
  selectYoutubeIdeaObscurity,
  validateYoutubeIdeaV2,
  youtubeIdeaEpisodeHasDecision,
  youtubeIdeaCenturyBucket,
  type YoutubeIdeaSeed,
} from './idea-quality';

const packet = {
  evidenceTier: 'no-performance-data' as const,
  packet: {
    channel: { language: 'vi' },
    request: { presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
    coverage: { projects: [], syncedVideos: [], savedIdeas: [] },
  },
  serialized: JSON.stringify({
    channel: { language: 'vi' }, request: { presetId: 'hubris-trap', count: 4, targetDurationSec: 600 },
    coverage: { projects: [], syncedVideos: [], savedIdeas: [] },
  }),
  fingerprint: 'a'.repeat(64), coverageFingerprint: 'b'.repeat(64),
  packetSummary: { projectCount: 0, syncedVideoCount: 0, savedIdeaCount: 0, matureVideoCount: 0 },
};

function idea(overrides: Partial<YoutubeIdeaV2> = {}): YoutubeIdeaV2 {
  return {
    id: 'idea-1', episode: 'Chỉ huy kéo dài cuộc vây hãm sau khi tin tuyến tiếp tế đã an toàn.',
    period: 'thế kỷ XIII', place: 'đồng bằng', hunterArchetype: 'military', famousnessGuess: 'obscure',
    famousnessFallback: false, angle: 'hậu cần', title: 'Kế hoạch tự khép lại',
    hook: 'Người chỉ huy tin lối vượt sông vẫn nằm ngoài tầm nguy hiểm.',
    brief: 'Người chỉ huy tin tuyến tiếp tế đã an toàn. Kế hoạch kéo dài cuộc vây hãm. Một đường vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô đội hình khiến đường tiếp tế khó bảo vệ.',
    presetId: 'hubris-trap',
    motif: {
      hunter: { text: 'Người chỉ huy tin lối vượt sông an toàn.', evidence: 'strong' },
      perfectPlan: { text: 'Kế hoạch kéo dài cuộc vây hãm dựa vào quân số đông.', evidence: 'partial' },
      blindSpot: { text: 'Tuyến tiếp tế kéo dài nằm ngoài dự tính.', evidence: 'partial' },
      selfDestruction: { text: 'Chính quy mô quân số kéo dài tuyến tiếp tế và khiến lực lượng mắc kẹt.', evidence: 'strong' },
    },
    trap: {
      hunterBelief: 'Người chỉ huy tin lối vượt sông vẫn an toàn.',
      outsideVariable: 'Tuyến tiếp tế kéo dài nằm ngoài khung nhìn.',
      exploitedBy: 'Bên phòng thủ dùng đường vòng để cắt tuyến tiếp tế.',
      advantageThatBackfired: 'Chính quy mô quân số kéo dài tuyến tiếp tế và làm lực lượng mắc kẹt.',
    },
    trapSketch: 'Người chỉ huy tin lối vượt sông an toàn, nên kéo dài cuộc vây hãm; nhưng tuyến tiếp tế nằm ngoài khung nhìn; kết quả đội hình mắc kẹt vì chính quy mô của mình.',
    whyForThisChannel: 'Chủ đề phù hợp với hồ sơ kênh.', testVariable: 'topic',
    successCriterion: { description: 'So sánh mức giữ chân đầu video sau khi đăng.', afterVideos: 3 },
    claims: [{ text: 'Tuyến tiếp tế kéo dài khiến đội hình mắc kẹt; cần kiểm chứng sự kiện cụ thể.', confidence: 'medium' }],
    risks: ['Cần kiểm chứng địa điểm và bối cảnh.'], rarityGuess: 'unknown', evidenceTier: 'no-performance-data',
    scores: { fit: 4, clarity: 4, riskOfThinSources: 2 }, suggestedDurationSec: 600, suggestedChapterCount: 5,
    ...overrides,
  } as YoutubeIdeaV2;
}

function seed(overrides: Partial<YoutubeIdeaSeed> = {}): YoutubeIdeaSeed {
  return {
    id: 'seed-1', episode: 'Chỉ huy đổi hướng đoàn quân sau khi tin con đường chính đã an toàn.',
    yearOrPeriod: 'thế kỷ XIII', place: 'đồng bằng', hunterArchetype: 'military', domain: 'logistics', famousnessGuess: 'obscure',
    ...overrides,
  };
}

describe('YouTube idea quality rules', () => {
  it('recognizes Arabic, Roman and Vietnamese written century labels and separates BCE', () => {
    expect(youtubeIdeaCenturyBucket('thế kỷ XIII')).toBe(13);
    expect(youtubeIdeaCenturyBucket('thế kỷ 13')).toBe(13);
    expect(youtubeIdeaCenturyBucket('thế kỷ 18')).toBe(18);
    expect(youtubeIdeaCenturyBucket('Late 13th century')).toBe(13);
    expect(youtubeIdeaCenturyBucket('cuối thế kỷ mười tám')).toBe(18);
    expect(youtubeIdeaCenturyBucket('đầu thế kỷ hai mươi')).toBe(20);
    expect(youtubeIdeaCenturyBucket('thế kỷ 5 TCN')).toBe(-5);
    expect(youtubeIdeaCenturyBucket('thế kỷ 5 trước Công nguyên')).toBe(-5);
    expect(youtubeIdeaCenturyBucket('480 BCE')).toBe(-5);
    expect(youtubeIdeaCenturyBucket('480 B.C.')).toBe(-5);
    expect(youtubeIdeaCenturyBucket('1527')).toBe(16);
    expect(youtubeIdeaCenturyBucket('Thời Nam Việt')).toBeNull();
  });

  it('normalizes only harmless fields, enums, unknown keys and singleton arrays', () => {
    const value = {
      id: 'idea-1', episode: 'episode', period: 'period', place: 'place', hunterArchetype: 'MILITARY',
      famousnessGuess: 'OBSCURE', domain: 'logistics', angle: 'supply', title: 'T'.repeat(101),
      hook: 'hook', brief: 'brief', presetId: 'HUBRIS-TRAP', testVariable: 'TOPIC',
      whyForThisChannel: `${'lý do '.repeat(80)}`, risks: [`${'rủi ro '.repeat(80)}`],
      claims: { text: `${'claim '.repeat(40)}`, confidence: 'LOW', extra: true }, extra: 'drop me',
    };
    const result = normalizeYoutubeIdeaStageOutput('expand', value) as { ideas: Record<string, unknown>[] };
    expect(result.ideas).toHaveLength(1);
    expect(result.ideas[0]).not.toHaveProperty('extra');
    expect(result.ideas[0]?.hunterArchetype).toBe('military');
    expect(result.ideas[0]?.testVariable).toBe('topic');
    expect(result.ideas[0]?.title).toBe('T'.repeat(101));
    expect(String(result.ideas[0]?.whyForThisChannel).length).toBeLessThanOrEqual(300);
    expect((result.ideas[0]?.claims as { text: string }[])[0]?.text.length).toBeLessThanOrEqual(160);
  });

  it('requires a non-thin blind spot and another non-thin load-bearing link', () => {
    const thin = idea({ motif: {
      hunter: { text: 'Người chỉ huy tin lối vượt sông an toàn.', evidence: 'strong' },
      perfectPlan: { text: 'Kế hoạch kéo dài cuộc vây hãm dựa vào quân số đông.', evidence: 'partial' },
      blindSpot: { text: 'Tuyến tiếp tế kéo dài nằm ngoài dự tính.', evidence: 'thin' },
      selfDestruction: { text: 'Chính quy mô quân số kéo dài tuyến tiếp tế.', evidence: 'strong' },
    } } as Partial<YoutubeIdeaV2>);
    expect(validateYoutubeIdeaV2(thin, packet).reasons.join(' ')).toContain('blind spot mỏng');
  });

  it('rejects a bad-luck-only advantage and an unquoted moral-label title', () => {
    const luck = idea({ trap: { ...idea().trap, advantageThatBackfired: 'Dịch bệnh bất ngờ làm quân đội suy yếu.' } });
    expect(validateYoutubeIdeaV2(luck, packet).reasons.join(' ')).toContain('không phải bẫy tự giăng');
    const label = idea({ title: 'Hoàng tử bán nước trong một quyết định sai lầm' });
    expect(validateYoutubeIdeaV2(label, packet).reasons.join(' ')).toContain('nhãn đạo đức');
  });

  it('rejects person biographies and requires factual numbers and names in claims or packet', () => {
    const biography = idea({ episode: 'Trần Ích Tắc', period: 'thế kỷ XIII' });
    expect(validateYoutubeIdeaV2(biography, packet).reasons.join(' ')).toContain('chưa phải một tập sự kiện');
    const missingNumber = idea({ brief: 'Người chỉ huy tin tuyến tiếp tế an toàn. Kế hoạch kéo dài cuộc vây hãm. Một đường vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô đội hình khiến đường tiếp tế khó bảo vệ vào năm 1527.' });
    expect(validateYoutubeIdeaV2(missingNumber, packet).reasons.join(' ')).toContain('số chưa có claim');
    const missingName = idea({ title: 'Trần Ích Tắc và kế hoạch tự khép lại' });
    expect(validateYoutubeIdeaV2(missingName, packet).reasons.join(' ')).toContain('tên chưa có claim');
    const groundedByPacket = idea({ brief: 'Người chỉ huy tin tuyến tiếp tế an toàn. Kế hoạch kéo dài cuộc vây hãm. Một đường vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô đội hình khiến kế hoạch khó xoay chuyển vào năm 1527.' });
    expect(validateYoutubeIdeaV2(groundedByPacket, { ...packet, serialized: `${packet.serialized} 1527` }).reasons).toEqual([]);
  });

  it('recognizes own strengths without treating ordinary sentence openings as proper names', () => {
    const strengthText = 'Thế mạnh kỵ binh khiến đội hình tiến sâu rồi khó rút lui.';
    const strength = idea({
      brief: 'Đây. Tập trung quân ở vùng đồng bằng. Kế hoạch kéo dài cuộc vây hãm. Một đường vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô đội hình khiến đường tiếp tế khó bảo vệ.',
      trap: { ...idea().trap, advantageThatBackfired: strengthText },
      motif: {
        ...idea().motif,
        selfDestruction: { text: strengthText, evidence: 'strong' },
      },
      claims: [{ text: 'Thế mạnh kỵ binh khiến đội hình tiến sâu rồi khó rút lui.', confidence: 'medium' }],
    });
    const validation = validateYoutubeIdeaV2(strength, packet);
    expect(validation.reasons.join(' ')).not.toContain('không phải bẫy tự giăng');
    expect(validation.reasons.join(' ')).not.toContain('tên chưa có claim');
  });

  it('flags a proper name at sentence start but ignores a causal question', () => {
    const base = idea({ hook: 'Khi tuyến tiếp tế bị cắt, điều gì khiến đội hình mắc kẹt?' });
    const audit = validateYoutubeIdeaV2(base, packet);
    expect(audit.reasons.join(' ')).not.toContain('mệnh đề nhân quả');
    const named = idea({ title: 'Trần Ích Tắc và kế hoạch tự khép lại' });
    expect(validateYoutubeIdeaV2(named, packet).reasons.join(' ')).toContain('tên chưa có claim');
  });

  it('ignores ordinary sentence openers while retaining unsupported proper names at sentence start', () => {
    expect(auditYoutubeIdeaClaimCoverage(idea({ title: 'Vậy' }), packet.serialized).unbackedNames).not.toContain('vay');
    expect(auditYoutubeIdeaClaimCoverage(idea({ title: 'Biến số' }), packet.serialized).unbackedNames).not.toContain('bien');
    expect(auditYoutubeIdeaClaimCoverage(idea({ title: 'Vấn đề' }), packet.serialized).unbackedNames).not.toContain('van');
    const capturedOpeners = idea({ brief: 'Mọi chi tiết về diễn biến cần đối chiếu. Tính hòa giải của người ra quyết định là giả thuyết.' });
    const capturedNames = auditYoutubeIdeaClaimCoverage(capturedOpeners, packet.serialized).unbackedNames;
    expect(capturedNames).not.toContain('moi');
    expect(capturedNames).not.toContain('tinh');
    expect(auditYoutubeIdeaClaimCoverage(idea({ title: 'Đại Việt' }), packet.serialized).unbackedNames).toContain('dai viet');
  });

  it('matches short acronyms and actor parent-child names in trap motif links only', () => {
    const voc = idea({
      motif: { ...idea().motif, hunter: { text: 'Công ty Đông Ấn Hà Lan (VOC), thế lực thương mại ở Maluku.', evidence: 'strong' } },
      trap: { ...idea().trap, hunterBelief: 'VOC tin rằng đốt phá cây ngoài vùng kiểm soát sẽ giữ chặt độc quyền gia vị.' },
    });
    expect(validateYoutubeIdeaV2(voc, packet).reasons.join(' ')).not.toContain('bốn dòng bẫy chưa nhất quán');

    const navy = idea({
      motif: { ...idea().motif, hunter: { text: 'Hải quân Đế quốc Nga, với hạm đội Baltic do Rozhestvensky chỉ huy.', evidence: 'strong' } },
      trap: { ...idea().trap, hunterBelief: 'Hải quân Nga tin rằng đưa hạm đội Baltic sang kịp thời sẽ cứu được Cảng Arthur.' },
    });
    expect(validateYoutubeIdeaV2(navy, packet).reasons.join(' ')).not.toContain('bốn dòng bẫy chưa nhất quán');

    const beiyang = idea({
      motif: { ...idea().motif, hunter: { text: 'Triều Thanh, bên xây dựng hạm đội Bắc Dương.', evidence: 'strong' } },
      trap: { ...idea().trap, hunterBelief: 'Tàu và trang bị hiện đại là đủ để có một hạm đội mạnh.' },
    });
    expect(validateYoutubeIdeaV2(beiyang, packet).reasons.join(' ')).toContain('bốn dòng bẫy chưa nhất quán');
  });

  it('accepts evidence-backed period refinement and a year that supports its century', () => {
    expect(isYoutubeIdeaPeriodRefinement('thời Pháp thuộc', 'thời Pháp thuộc, năm 1930', 'claims mention 1930')).toBe(true);
    expect(isYoutubeIdeaPeriodRefinement('cuối thế kỷ trước', 'cuối thế kỷ trước, năm 1998', 'claims mention 1998')).toBe(true);
    expect(isYoutubeIdeaPeriodRefinement('đầu thế kỷ 20', '1904–1905', 'claims mention 1904 and 1905')).toBe(true);
    expect(isYoutubeIdeaPeriodRefinement('thế kỷ 20', 'năm 1800', 'claims mention 1800')).toBe(false);

    const russianFleet = idea({ period: 'đầu thế kỷ 20', claims: [{ text: 'The action took place in 1904–1905.', confidence: 'medium' }] });
    expect(auditYoutubeIdeaClaimCoverage(russianFleet, packet.serialized).unbackedNumbers).not.toContain('20');
    expect(auditYoutubeIdeaClaimCoverage(idea({ period: 'thế kỷ 20' }), `${packet.serialized} year 1904`).unbackedNumbers).not.toContain('20');
    const wrongCentury = idea({ period: 'thế kỷ 20', claims: [{ text: 'The event happened in 1800.', confidence: 'medium' }] });
    expect(auditYoutubeIdeaClaimCoverage(wrongCentury, packet.serialized).unbackedNumbers).toContain('20');
  });

  it('flags single-word names at sentence starts and standalone place fields', () => {
    const namedHook = idea({ hook: 'Napoleon ra lệnh rút lui.' });
    const namedPlace = idea({ place: 'Huế' });
    expect(auditYoutubeIdeaClaimCoverage(namedHook, packet.serialized).unbackedNames).toContain('napoleon');
    expect(auditYoutubeIdeaClaimCoverage(namedPlace, packet.serialized).unbackedNames).toContain('hue');
  });

  it('does not treat the verb điều khiển as the causal word khiến', () => {
    const row = idea({
      brief: 'Người chỉ huy điều khiển các cuộc tranh luận trong triều. Kế hoạch kéo dài cuộc vây hãm. Một đường vòng nằm ngoài tính toán. Bên phòng thủ cắt tuyến tiếp tế. Quân đông bị dồn khỏi vị trí. Chính quy mô đội hình khiến đường tiếp tế khó bảo vệ.',
    });
    expect(auditYoutubeIdeaClaimCoverage(row, packet.serialized).unsupportedCausalStatements).toEqual([]);
  });

  it('accepts concrete episode actions and rejects a place phrase without a decision verb', () => {
    const moved = idea({ episode: 'Chỉ huy đem quân tiến sâu sau khi tin đường chính đã an toàn.' });
    const defended = idea({ episode: 'Người chỉ huy cố thủ sau khi lối tiếp tế bị đe dọa.' });
    const land = idea({ episode: 'Đất biên giới trải dài giữa hai vùng.' });
    expect(validateYoutubeIdeaV2(moved, packet).reasons.join(' ')).not.toContain('chưa phải một tập sự kiện');
    expect(validateYoutubeIdeaV2(defended, packet).reasons.join(' ')).not.toContain('chưa phải một tập sự kiện');
    expect(validateYoutubeIdeaV2(land, packet).reasons.join(' ')).toContain('chưa phải một tập sự kiện');
    const realSeedActions = [
      'Triệu Việt Vương chấp nhận chia đất và kết thông gia sau chiến thắng.',
      'Dương Tam Kha giành quyền nhiếp chính và nhận cháu làm con nuôi.',
      'Trần Quý Khoáng sát hại hai tướng trong quân đội.',
      'Vũ Văn Nhậm thu xếp Bắc Hà sau chiến thắng.',
      'Mạc Thiên Tứ giữ cân bằng giữa các thế lực ở Hà Tiên.',
      'Triều Nguyễn tự chế tàu máy hơi nước.',
      'Triều đình dồn thương nhân về một thương cảng đảo.',
      'Hồ Nguyên Trừng chế tạo súng thần cơ trước cuộc xâm lăng.',
      'Trần Duệ Tông dẫn quân vào sâu đất Chiêm Thành để đánh thẳng kinh đô.',
      'Giản Định Đế xử tướng cũ ngay sau chiến thắng.',
    ];
    for (const [index, episode] of realSeedActions.entries()) {
      expect(validateYoutubeIdeaV2(idea({ id: `episode-${index}`, episode }), packet).reasons.join(' ')).not.toContain('chưa phải một tập sự kiện');
    }
    expect(validateYoutubeIdeaV2(idea({ episode: 'Nguyễn Hữu Chỉnh dùng mưu lược xoay xở giữa các thế lực.' }), packet).reasons.join(' ')).toContain('chưa phải một tập sự kiện');

    const capturedActions = [
      'Hầu Nhân Bảo tiến quân vào Lạng Sơn sau khi tin đường núi đã mở.',
      'Giản Định Đế giết hai tướng sau khi họ làm trái lệnh.',
      'Triều Hồ cầu phong nhà Minh để củng cố vị thế.',
      'The Austro-Hungarian government sent an ultimatum after negotiations failed.',
      'Atahualpa agreed to meet the Spanish delegation at Cajamarca.',
      'Trịnh Sâm dựa vào binh lính Tam phủ để củng cố phủ chúa, rồi lực lượng ấy trở thành kiêu binh.',
      'Bạch Thái Bưởi mở tuyến tàu thủy cạnh tranh với các hãng nước ngoài đang thống trị đường sông.',
      'Thái Phiên và Trần Cao Vân chuẩn bị khởi nghĩa cùng vua trẻ, dựa vào bí mật và lòng tin của nhà vua.',
      'Đinh Tiên Hoàng lập con út làm người kế vị, bỏ qua người con cả từng có công trận.',
      'Minh Mạng tập trung quyền lực về trung ương và xóa bỏ cơ chế tổng trấn.',
      'Tôn Sĩ Nghị cho quân nghỉ ngơi ăn Tết ở Thăng Long sau thắng lợi nhanh.',
      'Trịnh Sâm bỏ người thừa kế chính thức để lập con của người sủng phi.',
      'Tự Đức ký hòa ước nhượng bộ để giữ yên biên giới.',
      'Triều đình cho thương nhân người Hoa nhận khai thác mỏ vùng thượng du để thu thuế, rồi mất kiểm soát lực lượng thợ mỏ đông đảo.',
      'Hoàng Hoa Thám tin vào thỏa thuận ngừng chiến với người Pháp để củng cố căn cứ, rồi bị thu hẹp không gian hoạt động.',
      'Công ty South Sea nhận gánh nợ quốc gia đổi lấy độc quyền thương mại, kéo cổ phiếu lên bằng kỳ vọng.',
      'Kodak giữ trọng tâm vào mảng phim chụp ảnh dù chính hãng đã tạo ra công nghệ máy ảnh kỹ thuật số.',
    ];
    for (const [index, episode] of capturedActions.entries()) {
      expect(validateYoutubeIdeaV2(idea({ id: `captured-${index}`, episode }), packet).reasons.join(' ')).not.toContain('chưa phải một tập sự kiện');
    }
    const watchIndustry = 'Ngành đồng hồ Thụy Sĩ giữ vững niềm tin vào cơ khí chính xác khi đồng hồ thạch anh xuất hiện.';
    const nguyenCitadel = 'Triều Nguyễn tin vào thành lũy và pháo cố định để chặn tàu chiến hơi nước phương Tây.';
    expect(youtubeIdeaEpisodeHasDecision(watchIndustry)).toBe(false);
    expect(youtubeIdeaEpisodeHasDecision(nguyenCitadel)).toBe(false);
    expect(validateYoutubeIdeaV2(idea({ episode: watchIndustry }), packet).reasons.join(' ')).toContain('chưa phải một tập sự kiện');
    expect(validateYoutubeIdeaV2(idea({ episode: nguyenCitadel }), packet).reasons.join(' ')).toContain('chưa phải một tập sự kiện');
  });

  it('drops ideas with a majority of low-confidence claims', () => {
    const low = idea({ claims: [
      { text: 'Một chi tiết cần kiểm chứng.', confidence: 'low' },
      { text: 'Một kết quả khác cần kiểm chứng.', confidence: 'low' },
      { text: 'Một mốc có độ tin cậy vừa.', confidence: 'medium' },
    ] });
    expect(validateYoutubeIdeaV2(low, packet).reasons.join(' ')).toContain('quá dựa vào trí nhớ');
  });

  it('enforces archetype-century, archetype and person caps while selecting episode seeds', () => {
    const rows = [
      seed({ id: 'a', episode: 'Chỉ huy ký lệnh mở đường tiếp tế.', hunterArchetype: 'military', yearOrPeriod: 'thế kỷ XIII' }),
      seed({ id: 'b', episode: 'Chỉ huy đổi tuyến hành quân.', hunterArchetype: 'military', yearOrPeriod: 'thế kỷ XIII' }),
      seed({ id: 'c', episode: 'Người đứng đầu ban thuế mới.', hunterArchetype: 'political', yearOrPeriod: 'thế kỷ XIV' }),
      seed({ id: 'd', episode: 'Người đứng đầu ký hiệp ước mới.', hunterArchetype: 'political', yearOrPeriod: 'thế kỷ XV' }),
      seed({ id: 'e', episode: 'Người đứng đầu đổi luật thuế.', hunterArchetype: 'political', yearOrPeriod: 'thế kỷ XVI' }),
      seed({ id: 'f', episode: 'Tướng Trần Ích Tắc đổi tuyến rút lui.', hunterArchetype: 'diplomatic', yearOrPeriod: 'thế kỷ XIII' }),
      seed({ id: 'g', episode: 'Tướng Trần Ích Tắc ký thỏa thuận khác.', hunterArchetype: 'diplomatic', yearOrPeriod: 'thế kỷ XIV' }),
      seed({ id: 'h', episode: 'Tướng Trần Ích Tắc điều quân sang đường khác.', hunterArchetype: 'economic', yearOrPeriod: 'thế kỷ XV' }),
    ];
    const result = filterYoutubeIdeaSeeds(rows, 6);
    expect(result.seeds.map((row) => row.id)).toEqual(['a', 'c', 'd', 'f', 'g']);
    expect(result.dropped.map((row) => row.reason).join(' ')).toContain('trùng loại bẫy');
  });

  it('does not let ineligible famous seeds consume obscure-mode diversity slots', () => {
    const rows = [
      seed({ id: 'famous', episode: 'Napoleon kéo dài cuộc vây hãm.', yearOrPeriod: 'thế kỷ 13', hunterArchetype: 'military', famousnessGuess: 'famous' }),
      seed({ id: 'obscure-military', episode: 'Chỉ huy đổi tuyến rút lui.', yearOrPeriod: 'thế kỷ 13', hunterArchetype: 'military', famousnessGuess: 'obscure' }),
      seed({ id: 'obscure-political', episode: 'Quan lại ban hành luật thuế.', yearOrPeriod: 'thế kỷ 14', hunterArchetype: 'political', famousnessGuess: 'obscure' }),
      seed({ id: 'known', episode: 'Quan chức ban hành luật thuế.', yearOrPeriod: 'thế kỷ 15', hunterArchetype: 'economic', famousnessGuess: 'known' }),
    ];
    const result = filterYoutubeIdeaSeeds(rows, 4, 'lịch sử ít người biết');
    expect(result.seeds.map((row) => row.id)).toEqual(['obscure-military', 'obscure-political', 'known']);
    expect(result.dropped.some((row) => row.id === 'famous' && row.reason.includes('famous'))).toBe(true);
  });

  it('groups only adjacent capitalized words when enforcing repeated person limits', () => {
    const rows = [
      seed({ id: 'a', episode: 'Trần Ích Tắc ký hiệp ước với Nguyên triều.', yearOrPeriod: 'thế kỷ 13', hunterArchetype: 'military' }),
      seed({ id: 'b', episode: 'Trần Ích Tắc ký hiệp ước với Tống triều.', yearOrPeriod: 'thế kỷ 14', hunterArchetype: 'political' }),
      seed({ id: 'c', episode: 'Trần Ích Tắc ký hiệp ước với Minh triều.', yearOrPeriod: 'thế kỷ 15', hunterArchetype: 'economic' }),
    ];
    const result = filterYoutubeIdeaSeeds(rows, 6);
    expect(result.seeds.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result.dropped).toContainEqual({ id: 'c', reason: 'trùng nhân vật hoặc chính thể quá hai lần.' });
  });

  it('drops famous ideas under obscure steering and marks known guesses as fallback only when needed', () => {
    const ideas = [
      idea({ id: 'obscure-1', famousnessGuess: 'obscure' }),
      idea({ id: 'known-1', famousnessGuess: 'known' }),
      idea({ id: 'famous-1', famousnessGuess: 'famous' }),
    ];
    const result = selectYoutubeIdeaObscurity(ideas, 2, 'lịch sử Việt Nam, ít người biết');
    expect(result.ideas.map((row) => row.id)).toEqual(['obscure-1', 'known-1']);
    expect(result.ideas[1]?.famousnessFallback).toBe(true);
    expect(result.dropped.some((row) => row.id === 'famous-1')).toBe(true);
    expect(YOUTUBE_IDEA_AVOID_LISTS.vietnameseHistory).toContain('Trần Hưng Đạo');
  });

  it('ranks by critic score, preserves diversity and uses known guesses only for a short obscure list', () => {
    const rows = [
      idea({ id: 'known', title: 'Kế hoạch thuế mới', famousnessGuess: 'known', hunterArchetype: 'economic', period: 'thế kỷ XV', angle: 'tax', scores: { fit: 5, clarity: 5, riskOfThinSources: 0 } }),
      idea({ id: 'obscure-1', title: 'Tuyến tiếp tế bị cắt', famousnessGuess: 'obscure', hunterArchetype: 'military', period: 'thế kỷ XIII', angle: 'supply', scores: { fit: 4, clarity: 4, riskOfThinSources: 1 } }),
      idea({ id: 'obscure-2', title: 'Điểm mù trong hiệp ước', famousnessGuess: 'obscure', hunterArchetype: 'political', period: 'thế kỷ XIV', angle: 'legitimacy', scores: { fit: 3, clarity: 4, riskOfThinSources: 1 } }),
      idea({ id: 'famous', title: 'Thương lượng ở biên giới', famousnessGuess: 'famous', hunterArchetype: 'diplomatic', period: 'thế kỷ XVI', angle: 'treaty', scores: { fit: 5, clarity: 5, riskOfThinSources: 0 } }),
    ];
    const enough = trimYoutubeIdeaV2Final(rows, 2, 'lịch sử Việt Nam, ít người biết');
    expect(enough.ideas.map((row) => row.id)).toEqual(['obscure-1', 'obscure-2']);
    expect(enough.ideas.every((row) => !row.famousnessFallback)).toBe(true);
    const shortage = trimYoutubeIdeaV2Final(rows, 3, 'lịch sử Việt Nam, ít người biết');
    expect(shortage.ideas.map((row) => row.id)).toEqual(['obscure-1', 'obscure-2', 'known']);
    expect(shortage.ideas[2]?.famousnessFallback).toBe(true);
  });

  it('drops duplicate and near-duplicate titles within the final ranked set', () => {
    const rows = [
      idea({ id: 'first', title: 'Kế hoạch tự khép lại', hunterArchetype: 'military', period: 'thế kỷ XIII', angle: 'supply', scores: { fit: 5, clarity: 5, riskOfThinSources: 0 } }),
      idea({ id: 'duplicate', title: 'Ke hoach tu khep lai', hunterArchetype: 'political', period: 'thế kỷ XIV', angle: 'legitimacy', scores: { fit: 4, clarity: 4, riskOfThinSources: 1 } }),
      idea({ id: 'third', title: 'Một điểm mù khiến hệ thống đổi hướng', hunterArchetype: 'economic', period: 'thế kỷ XV', angle: 'tax', scores: { fit: 3, clarity: 3, riskOfThinSources: 1 } }),
    ];
    const result = trimYoutubeIdeaV2Final(rows, 3, '');
    expect(result.ideas.map((row) => row.id)).toEqual(['first', 'third']);
    expect(result.dropped.some((row) => row.id === 'duplicate' && row.reason.includes('tiêu đề trùng'))).toBe(true);
  });
});
